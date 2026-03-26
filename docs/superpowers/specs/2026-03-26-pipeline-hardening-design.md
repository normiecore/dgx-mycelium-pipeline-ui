# Knowledge Harvester Pipeline — Hardening & Deployment Spec

**Date:** 2026-03-26
**Status:** Approved
**Repo:** `knowledge-harvester-pipeline`
**Depends on:** `2026-03-26-knowledge-harvester-pipeline-design.md` (base implementation)

## Overview

Harden the existing pipeline for deployment on RunPod (RTX 4000 Ada, 20 GB VRAM) with a Docker Compose stack that runs identically on the target GB10 hardware. Adds JWT verification, Graph API pagination, rate limiting, concurrency control, health checks, and containerization.

## Deployment Architecture

```
GitHub Repo
    │  docker compose up
    ▼
┌─────────────────────────────────────────────┐
│  RunPod Pod / GB10                           │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │  NATS    │  │  vLLM    │  │ MuninnDB  │  │
│  │  :4222   │  │  :8000   │  │  :3030    │  │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
│       │              │              │         │
│  ┌────▼──────────────▼──────────────▼─────┐  │
│  │           Pipeline Container            │  │
│  │  • Graph API poller (internet)          │  │
│  │  • Processing pipeline                  │  │
│  │  • REST API :3001                       │  │
│  └─────────────────────────────────────────┘  │
└───────────────────────────────────────────────┘
```

Same `docker-compose.yml` on both RunPod and GB10. No override files. GPU resources scale with available hardware.

## Decisions

1. **Docker Compose** — single compose file for RunPod and GB10
2. **vLLM** — same LLM serving engine on both targets, OpenAI-compatible API
3. **Llama 3.1 8B Instruct AWQ** — 4-bit quantized, ~5 GB VRAM, room for KV cache on 20 GB
4. **NATS JetStream** — message persistence across container restarts
5. **M365 Developer tenant** — free E5 sandbox with sample data for dev/demo
6. **JWT auth with mode toggle** — AUTH_MODE=azure|dev
7. **Graph API pagination** — follow @odata.nextLink
8. **Rate limiting + exponential backoff** — retry on Graph 429/503
9. **Concurrency limiter** — cap LLM calls at MAX_CONCURRENT_EXTRACTIONS
10. **Health checks** — enriched /api/health + Docker healthchecks

## Docker Compose

### Services

**nats** — Message queue with JetStream persistence
- Image: `nats:2.10-alpine`
- Port: 4222
- Command: `--jetstream --store_dir=/data`
- Volume: `nats-data:/data`
- Healthcheck: `nats-server --health`

**vllm** — LLM serving
- Image: `vllm/vllm-openai:latest`
- Port: 8000
- GPU: 1x NVIDIA (reserved via deploy.resources)
- Command: `--model=meta-llama/Llama-3.1-8B-Instruct-AWQ --quantization=awq --max-model-len=4096 --gpu-memory-utilization=0.85`
- Volume: `model-cache:/root/.cache/huggingface` (persists weights across restarts)
- Healthcheck: `curl http://localhost:8000/health`

**muninndb** — Knowledge storage
- Image: `muninndb:latest`
- Port: 3030
- Volume: `muninndb-data:/data`
- Environment: `MUNINNDB_API_KEY` from .env
- Healthcheck: `curl http://localhost:3030/health`

**pipeline** — The harvester pipeline application
- Build: `Dockerfile` (multi-stage, node:22-alpine)
- Port: 3001
- Depends on: nats, vllm, muninndb
- Environment: service URLs via Docker networking (nats://nats:4222, http://vllm:8000/v1, http://muninndb:3030)
- Env file: `.env` for Azure AD secrets
- Healthcheck: `curl http://localhost:3001/api/health`

### Volumes

- `nats-data` — JetStream message persistence
- `model-cache` — Hugging Face model weights (avoids re-download)
- `muninndb-data` — MuninnDB engram storage

## Code Hardening

### 1. JWT Authentication (AUTH_MODE toggle)

Replace current decode-only `extractUserId` with proper JWT verification.

**Two modes via `AUTH_MODE` env var:**

`AUTH_MODE=azure` (production):
- Fetch JWKS from `https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys`
- Validate signature, issuer (`iss`), audience (`aud`), expiration (`exp`)
- Uses `jsonwebtoken` + `jwks-rsa` packages
- JWKS keys cached with automatic rotation

`AUTH_MODE=dev` (development/testing):
- Accepts tokens signed with `JWT_DEV_SECRET` env var
- Same payload structure (oid, preferred_username)
- Tests can generate valid tokens without Azure AD

**New dependencies:** `jsonwebtoken`, `jwks-rsa`, `@types/jsonwebtoken`

**Files changed:**
- `src/api/auth.ts` — rewrite with verification
- `src/config/index.ts` — add AUTH_MODE + JWT config
- `tests/api/auth.test.ts` — test both modes

### 2. Graph API Pagination

Add `@odata.nextLink` loop to `graph-poller.ts`.

Current behavior: single API call, processes `response.value`, saves deltaLink.
New behavior: follow `@odata.nextLink` until `@odata.deltaLink` is returned, accumulating all pages.

```
while (url) {
  response = await graphClient.api(url).get()
  process(response.value)
  url = response['@odata.nextLink'] || null
}
saveDeltaLink(response['@odata.deltaLink'])
```

**Files changed:**
- `src/ingestion/graph-poller.ts` — add pagination loop
- `tests/ingestion/graph-poller.test.ts` — test multi-page responses

### 3. Rate Limiting + Exponential Backoff

Wrap Graph API calls with retry logic.

**Behavior:**
- Detect HTTP 429 (Too Many Requests) and 503 (Service Unavailable)
- Read `Retry-After` header if present
- Exponential backoff: 1s → 2s → 4s → 8s → max 60s
- Max 3 retries per request
- Log each retry with delay

**Implementation:** A `retryWithBackoff(fn, maxRetries)` utility in `src/ingestion/graph-retry.ts`. Wraps the Graph client's `.get()` calls in the poller.

**Files created:**
- `src/ingestion/graph-retry.ts`
- `tests/ingestion/graph-retry.test.ts`

**Files changed:**
- `src/ingestion/graph-poller.ts` — use retry wrapper

### 4. Concurrency Limiter for LLM Calls

Cap concurrent vLLM requests using a semaphore.

**Implementation:** Simple counting semaphore in `src/pipeline/concurrency-limiter.ts`. The pipeline processor wraps `extractor.extract()` with `limiter.run(() => ...)`.

Limit set by `MAX_CONCURRENT_EXTRACTIONS` config (default 8).

**Files created:**
- `src/pipeline/concurrency-limiter.ts`
- `tests/pipeline/concurrency-limiter.test.ts`

**Files changed:**
- `src/pipeline/processor.ts` — add limiter around extraction
- `src/main.ts` — pass limiter to processor

### 5. Dead Letter Publishing

Wire `TOPICS.DEAD_LETTER` into the NATS error handler.

Current behavior: failed captures logged to console only.
New behavior: publish `{ capture, error, timestamp }` to `pipeline.deadletter` NATS topic, then log.

**Files changed:**
- `src/main.ts` — publish to dead letter in catch block

### 6. Health Checks + Observability

Enrich `/api/health` with service status and pipeline counters.

**Response shape:**
```json
{
  "status": "ok",
  "uptime_seconds": 3842,
  "services": {
    "nats": "connected",
    "vllm": "healthy",
    "muninndb": "healthy"
  },
  "pipeline": {
    "processed_total": 142,
    "blocked_total": 18,
    "deduplicated_total": 63,
    "errors_total": 2,
    "last_poll_at": "2026-03-26T10:30:00Z"
  }
}
```

**Implementation:**
- In-memory counters object in `src/pipeline/metrics.ts`
- Processor increments counters after each stage
- Health route checks each service (NATS connection status, vLLM /health, MuninnDB /health)

**Files created:**
- `src/pipeline/metrics.ts`
- `tests/pipeline/metrics.test.ts`

**Files changed:**
- `src/pipeline/processor.ts` — increment metrics
- `src/api/server.ts` — enriched health endpoint
- `src/main.ts` — pass metrics to processor and server

### 7. Dockerfile

Multi-stage build:

```dockerfile
# Build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Runtime stage
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY prompts/ ./prompts/
EXPOSE 3001
CMD ["node", "dist/src/main.js"]
```

~100 MB image. No dev dependencies in runtime.

## Configuration Updates

New env vars added to `.env.example`:

```
# Existing
AZURE_TENANT_ID=
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
NATS_URL=nats://nats:4222
MUNINNDB_URL=http://muninndb:3030
MUNINNDB_API_KEY=
LLM_BASE_URL=http://vllm:8000/v1
LLM_MODEL=meta-llama/Llama-3.1-8B-Instruct-AWQ
POLL_INTERVAL_MS=30000
MAX_CONCURRENT_EXTRACTIONS=8

# New
AUTH_MODE=dev
JWT_DEV_SECRET=dev-secret-change-me
AZURE_AD_AUDIENCE=
```

## Project Structure (new/changed files)

```
knowledge-harvester-pipeline/
├── docker-compose.yml              # NEW — all services
├── Dockerfile                      # NEW — pipeline container
├── .dockerignore                   # NEW
├── src/
│   ├── config/
│   │   └── index.ts                # CHANGED — add auth config
│   ├── ingestion/
│   │   ├── graph-poller.ts         # CHANGED — pagination + retry
│   │   └── graph-retry.ts          # NEW — retry with backoff
│   ├── pipeline/
│   │   ├── processor.ts            # CHANGED — concurrency limiter + metrics
│   │   ├── concurrency-limiter.ts  # NEW — semaphore
│   │   └── metrics.ts              # NEW — pipeline counters
│   ├── api/
│   │   ├── auth.ts                 # CHANGED — JWT verification
│   │   └── server.ts               # CHANGED — enriched health
│   └── main.ts                     # CHANGED — dead letter, metrics, limiter
└── tests/
    ├── ingestion/
    │   ├── graph-poller.test.ts    # CHANGED — pagination tests
    │   └── graph-retry.test.ts     # NEW
    ├── pipeline/
    │   ├── concurrency-limiter.test.ts  # NEW
    │   └── metrics.test.ts         # NEW
    └── api/
        └── auth.test.ts            # CHANGED — test both modes
```

## Not In Scope

- Window polling / screenshot capture (Phase 2 — desktop repo)
- OCR / VLM processing stages (Phase 2)
- Tauri desktop app (separate repo)
- Production Azure AD app registration (manual IT governance step)
- Multi-node scaling (future, when org-wide)
