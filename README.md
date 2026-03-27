# Knowledge Harvester Pipeline

Captures organisational knowledge from Microsoft 365 (email, Teams, calendar, OneDrive, To-Do), extracts insights via LLM, and stores them as engrams in MuninnDB. Includes a web UI for reviewing, approving, and searching extracted knowledge.

## Architecture

```
M365 Graph API  -->  NATS  -->  Pipeline  -->  MuninnDB
  (mail, teams,       |        (6 stages)     (3-tier vaults)
   calendar,          |
   onedrive, todo)    |
                      v
                  Web UI (React)
                  - Review queue
                  - Approved engrams
                  - Search (FTS5 + semantic)
                  - Health dashboard
```

### Pipeline Stages
1. **Sensitivity pre-filter** — blocks HR, medical, financial content (configurable rules)
2. **Deduplication** — SHA256 hash, skips identical content
3. **LLM extraction** — summary, tags, confidence, sensitivity (with retry + dead-letter)
4. **LLM sensitivity gate** — CoT classification
5. **Storage** — MuninnDB (source of truth) + local SQLite index (cache)
6. **Notification** — NATS + WebSocket to UI

### Data Sources
| Source | Graph API Endpoint | Delta Support |
|--------|-------------------|---------------|
| Email | `/mailFolders/inbox/messages/delta` | Yes |
| Teams | `/chats/getAllMessages/delta` | Yes |
| Calendar | `/events/delta` | Yes |
| OneDrive | `/drive/root/delta` | Yes |
| To-Do | `/todo/lists/{id}/tasks` | Timestamp-based |

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your values

# Build
npm run build

# Run
npm start

# Or dev mode (no build needed)
npm run dev
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AZURE_TENANT_ID` | Azure AD tenant | (required for Graph API) |
| `AZURE_CLIENT_ID` | Azure AD app client ID | (required for Graph API) |
| `AZURE_CLIENT_SECRET` | Azure AD app secret | (required for Graph API) |
| `AUTH_MODE` | `dev` or `azure` | `dev` |
| `JWT_DEV_SECRET` | Dev mode JWT secret | `dev-secret-change-me` |
| `NATS_URL` | NATS server URL | `nats://localhost:4222` |
| `MUNINNDB_URL` | MuninnDB server URL | `http://localhost:3030` |
| `MUNINNDB_API_KEY` | MuninnDB API key | (required) |
| `LLM_BASE_URL` | vLLM/Ollama base URL | `http://localhost:8000/v1` |
| `LLM_MODEL` | Model identifier | `hugging-quants/Meta-Llama-3.1-8B-Instruct-AWQ-INT4` |
| `POLL_INTERVAL_MS` | Graph API poll interval | `30000` |
| `MAX_CONCURRENT_EXTRACTIONS` | LLM concurrency limit | `8` |
| `LOG_LEVEL` | Pino log level | `info` |

## RunPod Deployment

```bash
# On RunPod instance:
bash setup-runpod.sh    # one-time setup
bash start.sh           # start all services (NATS + vLLM + pipeline)
```

Or use Docker:
```bash
docker build -f Dockerfile.runpod -t knowledge-harvester .
docker run --gpus all -p 3001:3001 knowledge-harvester
```

## Frontend

The React UI is served at `http://localhost:3001` and includes:

- **Review Queue** — pending engrams sorted by confidence, batch approve/dismiss, keyboard shortcuts (j/k/a/d)
- **Approved** — approved engrams with real-time WebSocket updates
- **Search** — hybrid search (FTS5 + MuninnDB semantic recall)
- **Health** — pipeline metrics, service status, auto-refresh

To rebuild the frontend after changes:
```bash
cd frontend && npm run build
```

## Testing

```bash
npm test              # run all 101 tests
npm run test:watch    # watch mode
```

## Customization

### Sensitivity Rules
Edit `sensitivity-rules.json` to customize blocked sources, title patterns, and content patterns without code changes. Delete the file to use hardcoded defaults.

### Index Rebuild
If the local SQLite index drifts from MuninnDB:
```bash
REBUILD_INDEX=1 npm start
# or
node dist/src/main.js --rebuild-index
```
