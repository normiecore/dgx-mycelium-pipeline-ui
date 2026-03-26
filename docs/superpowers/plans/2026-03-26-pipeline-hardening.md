# Pipeline Hardening & Deployment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the pipeline for RunPod deployment with JWT auth, Graph API pagination/retry, concurrency limiting, health checks, and Docker Compose containerization.

**Architecture:** Modify existing pipeline code to add production-grade auth, resilience, and observability. Package everything as a Docker Compose stack (NATS + vLLM + MuninnDB + pipeline) that runs identically on RunPod and GB10.

**Tech Stack:** jsonwebtoken, jwks-rsa, Docker, Docker Compose, vLLM, NATS JetStream

**Spec:** `docs/superpowers/specs/2026-03-26-pipeline-hardening-design.md`

---

## File Map

```
knowledge-harvester-pipeline/
├── docker-compose.yml                     # NEW — orchestrates all services
├── Dockerfile                             # NEW — multi-stage pipeline build
├── .dockerignore                          # NEW
├── src/
│   ├── config/
│   │   └── index.ts                       # MODIFIED — add auth config
│   ├── ingestion/
│   │   ├── graph-poller.ts                # MODIFIED — pagination loop + retry
│   │   └── graph-retry.ts                 # NEW — retry with exponential backoff
│   ├── pipeline/
│   │   ├── processor.ts                   # MODIFIED — concurrency limiter + metrics
│   │   ├── concurrency-limiter.ts         # NEW — counting semaphore
│   │   └── metrics.ts                     # NEW — pipeline counters
│   ├── api/
│   │   ├── auth.ts                        # MODIFIED — JWT verification with mode toggle
│   │   └── server.ts                      # MODIFIED — enriched health endpoint
│   └── main.ts                            # MODIFIED — dead letter, metrics, limiter, poll loop
├── .env.example                           # MODIFIED — new auth vars
└── tests/
    ├── ingestion/
    │   ├── graph-poller.test.ts           # MODIFIED — pagination tests
    │   └── graph-retry.test.ts            # NEW
    ├── pipeline/
    │   ├── processor.test.ts              # MODIFIED — limiter + metrics
    │   ├── concurrency-limiter.test.ts    # NEW
    │   └── metrics.test.ts                # NEW
    └── api/
        └── auth.test.ts                   # MODIFIED — test both modes
```

---

## Chunk 1: JWT Auth + Config

### Task 1: Install new dependencies

- [ ] **Step 1: Install JWT packages**

Run:
```bash
cd ~/knowledge-harvester-pipeline
npm install jsonwebtoken jwks-rsa
npm install @types/jsonwebtoken --save-dev
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add jsonwebtoken and jwks-rsa dependencies"
```

---

### Task 2: Update config with auth settings

**Files:**
- Modify: `src/config/index.ts`
- Modify: `tests/config/index.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write the test for new auth config fields**

Add to `tests/config/index.test.ts`:

```typescript
it('loads auth config in dev mode', () => {
  Object.assign(process.env, {
    ...VALID_ENV,
    AUTH_MODE: 'dev',
    JWT_DEV_SECRET: 'test-secret',
  });
  const config = loadConfig();
  expect(config.auth.mode).toBe('dev');
  expect(config.auth.devSecret).toBe('test-secret');
});

it('loads auth config in azure mode', () => {
  Object.assign(process.env, {
    ...VALID_ENV,
    AUTH_MODE: 'azure',
    AZURE_AD_AUDIENCE: 'api://my-app',
  });
  const config = loadConfig();
  expect(config.auth.mode).toBe('azure');
  expect(config.auth.azureAdAudience).toBe('api://my-app');
});

it('defaults to dev mode when AUTH_MODE not set', () => {
  Object.assign(process.env, VALID_ENV);
  const config = loadConfig();
  expect(config.auth.mode).toBe('dev');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config/index.test.ts`
Expected: FAIL — `config.auth` doesn't exist

- [ ] **Step 3: Update config implementation**

In `src/config/index.ts`, add auth to ConfigSchema:

```typescript
import { z } from 'zod';

const ConfigSchema = z.object({
  azure: z.object({
    tenantId: z.string().min(1),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  }),
  auth: z.object({
    mode: z.enum(['dev', 'azure']),
    devSecret: z.string().optional(),
    azureAdAudience: z.string().optional(),
  }),
  natsUrl: z.string().min(1),
  muninndb: z.object({
    url: z.string().url(),
    apiKey: z.string().min(1),
  }),
  llm: z.object({
    baseUrl: z.string().url(),
    model: z.string().min(1),
  }),
  pollIntervalMs: z.number().int().positive(),
  maxConcurrentExtractions: z.number().int().positive(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  return ConfigSchema.parse({
    azure: {
      tenantId: process.env.AZURE_TENANT_ID,
      clientId: process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
    },
    auth: {
      mode: process.env.AUTH_MODE || 'dev',
      devSecret: process.env.JWT_DEV_SECRET,
      azureAdAudience: process.env.AZURE_AD_AUDIENCE,
    },
    natsUrl: process.env.NATS_URL,
    muninndb: {
      url: process.env.MUNINNDB_URL,
      apiKey: process.env.MUNINNDB_API_KEY,
    },
    llm: {
      baseUrl: process.env.LLM_BASE_URL,
      model: process.env.LLM_MODEL,
    },
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '30000', 10),
    maxConcurrentExtractions: parseInt(process.env.MAX_CONCURRENT_EXTRACTIONS || '8', 10),
  });
}
```

- [ ] **Step 4: Update .env.example**

Add to `.env.example`:
```
AUTH_MODE=dev
JWT_DEV_SECRET=dev-secret-change-me
AZURE_AD_AUDIENCE=
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run tests/config/index.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/config/index.ts tests/config/index.test.ts .env.example
git commit -m "feat: add auth config with dev/azure mode toggle"
```

---

### Task 3: JWT auth with verification

**Files:**
- Modify: `src/api/auth.ts`
- Modify: `tests/api/auth.test.ts`

- [ ] **Step 1: Write tests for both auth modes**

Rewrite `tests/api/auth.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { createAuthVerifier, type AuthUser } from '../../src/api/auth.js';

const DEV_SECRET = 'test-secret-key';

function makeDevToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, DEV_SECRET, { algorithm: 'HS256' });
}

describe('auth - dev mode', () => {
  const verify = createAuthVerifier({ mode: 'dev', devSecret: DEV_SECRET });

  it('verifies a valid dev token', async () => {
    const token = makeDevToken({ oid: 'user-abc', preferred_username: 'james@example.com' });
    const user = await verify(token);
    expect(user.userId).toBe('user-abc');
    expect(user.userEmail).toBe('james@example.com');
  });

  it('rejects token signed with wrong secret', async () => {
    const token = jwt.sign({ oid: 'user-abc' }, 'wrong-secret');
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects expired token', async () => {
    const token = jwt.sign({ oid: 'user-abc', exp: Math.floor(Date.now() / 1000) - 60 }, DEV_SECRET);
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects token without oid claim', async () => {
    const token = makeDevToken({ preferred_username: 'james@example.com' });
    await expect(verify(token)).rejects.toThrow('Missing oid');
  });

  it('handles Bearer prefix', async () => {
    const token = makeDevToken({ oid: 'user-abc', preferred_username: 'j@e.com' });
    const user = await verify(`Bearer ${token}`);
    expect(user.userId).toBe('user-abc');
  });
});

describe('auth - azure mode', () => {
  it('creates verifier without throwing', () => {
    const verify = createAuthVerifier({
      mode: 'azure',
      azureAdAudience: 'api://test',
      azureTenantId: 'tenant-123',
    });
    expect(verify).toBeTypeOf('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/auth.test.ts`
Expected: FAIL — `createAuthVerifier` doesn't exist

- [ ] **Step 3: Rewrite auth.ts with verification**

```typescript
// src/api/auth.ts
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

export interface AuthUser {
  userId: string;
  userEmail: string;
}

export interface AuthConfig {
  mode: 'dev' | 'azure';
  devSecret?: string;
  azureAdAudience?: string;
  azureTenantId?: string;
}

export type AuthVerifier = (bearerToken: string) => Promise<AuthUser>;

export function createAuthVerifier(config: AuthConfig): AuthVerifier {
  if (config.mode === 'dev') {
    return createDevVerifier(config.devSecret || 'dev-secret');
  }
  return createAzureVerifier(config);
}

function createDevVerifier(secret: string): AuthVerifier {
  return async (bearerToken: string): Promise<AuthUser> => {
    const token = bearerToken.replace('Bearer ', '');
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    if (!payload.oid) throw new Error('Missing oid claim in JWT');
    return {
      userId: payload.oid as string,
      userEmail: (payload.preferred_username ?? payload.upn ?? '') as string,
    };
  };
}

function createAzureVerifier(config: AuthConfig): AuthVerifier {
  const jwksUri = `https://login.microsoftonline.com/${config.azureTenantId}/discovery/v2.0/keys`;
  const client = jwksClient({ jwksUri, cache: true, rateLimit: true });

  function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback): void {
    client.getSigningKey(header.kid, (err, key) => {
      if (err) return callback(err);
      callback(null, key?.getPublicKey());
    });
  }

  return async (bearerToken: string): Promise<AuthUser> => {
    const token = bearerToken.replace('Bearer ', '');
    const payload = await new Promise<jwt.JwtPayload>((resolve, reject) => {
      jwt.verify(
        token,
        getKey,
        {
          audience: config.azureAdAudience,
          issuer: `https://login.microsoftonline.com/${config.azureTenantId}/v2.0`,
        },
        (err, decoded) => {
          if (err) return reject(err);
          resolve(decoded as jwt.JwtPayload);
        },
      );
    });
    if (!payload.oid) throw new Error('Missing oid claim in JWT');
    return {
      userId: payload.oid as string,
      userEmail: (payload.preferred_username ?? payload.upn ?? '') as string,
    };
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/api/auth.test.ts`
Expected: PASS — all 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/api/auth.ts tests/api/auth.test.ts
git commit -m "feat: add JWT verification with dev/azure mode toggle"
```

---

### Task 4: Wire auth verifier into server

**Files:**
- Modify: `src/api/server.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Update ServerDeps to accept AuthVerifier**

In `src/api/server.ts`, add `authVerifier` to `ServerDeps`:

```typescript
import type { AuthVerifier } from './auth.js';

export interface ServerDeps {
  muninnClient: MuninnDBClient;
  vaultManager: VaultManager;
  engramIndex: EngramIndex;
  wsManager: WebSocketManager;
  authVerifier: AuthVerifier;
}
```

Replace the auth preHandler to use `authVerifier`:

```typescript
app.addHook('preHandler', async (req, reply) => {
  const url = req.url;
  if (url === '/api/health' || url.startsWith('/ws/')) return;
  if (!url.startsWith('/api/')) return;

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    reply.code(401).send({ error: 'Missing authorization header' });
    return;
  }

  try {
    (req as any).user = await deps.authVerifier(authHeader);
  } catch (err: any) {
    reply.code(401).send({ error: err.message });
  }
});
```

Also update the WebSocket handler to use `deps.authVerifier`.

- [ ] **Step 2: Update main.ts to create and pass authVerifier**

In `src/main.ts`, add:

```typescript
import { createAuthVerifier } from './api/auth.js';
```

After `loadConfig()`:

```typescript
const authVerifier = createAuthVerifier({
  mode: config.auth.mode,
  devSecret: config.auth.devSecret,
  azureAdAudience: config.auth.azureAdAudience,
  azureTenantId: config.azure.tenantId,
});
```

Pass to `createServer`:

```typescript
const server = await createServer({
  muninnClient, vaultManager, engramIndex, wsManager, authVerifier,
});
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (existing server/route tests mock the auth hook directly)

- [ ] **Step 4: Commit**

```bash
git add src/api/server.ts src/main.ts
git commit -m "feat: wire JWT auth verifier into server and main"
```

---

## Chunk 2: Graph API Resilience

### Task 5: Retry with exponential backoff

**Files:**
- Create: `src/ingestion/graph-retry.ts`
- Create: `tests/ingestion/graph-retry.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/ingestion/graph-retry.test.ts
import { describe, it, expect, vi } from 'vitest';
import { retryWithBackoff, RetryableError } from '../../src/ingestion/graph-retry.js';

describe('retryWithBackoff', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on RetryableError and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RetryableError(429, 'Too Many Requests'))
      .mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new RetryableError(429, 'Too Many Requests'));
    await expect(retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 10 })).rejects.toThrow('Too Many Requests');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Auth failed'));
    await expect(retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 10 })).rejects.toThrow('Auth failed');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects retryAfter delay', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RetryableError(429, 'Throttled', 1))
      .mockResolvedValue('ok');
    const start = Date.now();
    await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(900); // ~1 second
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ingestion/graph-retry.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// src/ingestion/graph-retry.ts

export class RetryableError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs = 60000 } = opts;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;

      if (!(err instanceof RetryableError)) throw err;
      if (attempt >= maxRetries) break;

      let delayMs: number;
      if (err.retryAfterSeconds) {
        delayMs = err.retryAfterSeconds * 1000;
      } else {
        delayMs = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      }

      console.log(`Retry ${attempt + 1}/${maxRetries} after ${delayMs}ms (${err.statusCode})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw lastError;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/ingestion/graph-retry.test.ts`
Expected: PASS — all 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/ingestion/graph-retry.ts tests/ingestion/graph-retry.test.ts
git commit -m "feat: add retry with exponential backoff for Graph API"
```

---

### Task 6: Graph poller pagination + retry integration

**Files:**
- Modify: `src/ingestion/graph-poller.ts`
- Modify: `tests/ingestion/graph-poller.test.ts`

- [ ] **Step 1: Add pagination test**

Add to `tests/ingestion/graph-poller.test.ts`:

```typescript
it('follows @odata.nextLink for pagination', async () => {
  const page1 = {
    value: [{ id: 'msg-1', subject: 'Page 1', bodyPreview: 'p1', body: { contentType: 'text', content: 'p1' }, from: { emailAddress: { name: 'A', address: 'a@e.com' } }, toRecipients: [], receivedDateTime: '2026-03-26T09:00:00Z', conversationId: 'c1' }],
    '@odata.nextLink': 'https://graph.microsoft.com/next-page',
  };
  const page2 = {
    value: [{ id: 'msg-2', subject: 'Page 2', bodyPreview: 'p2', body: { contentType: 'text', content: 'p2' }, from: { emailAddress: { name: 'B', address: 'b@e.com' } }, toRecipients: [], receivedDateTime: '2026-03-26T09:01:00Z', conversationId: 'c2' }],
    '@odata.deltaLink': 'https://graph.microsoft.com/delta?final',
  };

  mockGraphClient.api = vi.fn()
    .mockReturnValueOnce({ get: vi.fn().mockResolvedValue(page1) })
    .mockReturnValueOnce({ get: vi.fn().mockResolvedValue(page2) });

  await poller.pollMail('user-1', 'alice@example.com');

  expect(published).toHaveLength(2);
  expect(mockDeltaStore.setDeltaLink).toHaveBeenCalledWith('user-1', 'mail', 'https://graph.microsoft.com/delta?final');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ingestion/graph-poller.test.ts`
Expected: FAIL — only 1 message published, not 2

- [ ] **Step 3: Update graph-poller.ts with pagination loop**

Refactor `pollMail` and `pollTeamsChat` to loop through pages:

```typescript
async pollMail(userId: string, userEmail: string): Promise<void> {
  let url: string | undefined = this.deltaStore.getDeltaLink(userId, 'mail')
    ?? `/users/${userId}/mailFolders/inbox/messages/delta`;

  let deltaLink: string | undefined;

  while (url) {
    const response: GraphDeltaResponse<GraphMessage> =
      await this.graphClient.api(url).get();

    for (const msg of response.value) {
      const capture: RawCapture = {
        id: randomUUID(),
        userId,
        userEmail,
        sourceType: 'graph_email',
        sourceApp: 'outlook',
        capturedAt: msg.receivedDateTime,
        rawContent: JSON.stringify({
          subject: msg.subject,
          bodyPreview: msg.bodyPreview,
          from: msg.from?.emailAddress,
        }),
        metadata: { messageId: msg.id },
      };
      this.publish(capture);
    }

    deltaLink = response['@odata.deltaLink'];
    url = response['@odata.nextLink'];
  }

  if (deltaLink) {
    this.deltaStore.setDeltaLink(userId, 'mail', deltaLink);
  }
}
```

Apply the same pagination loop to `pollTeamsChat`:

```typescript
async pollTeamsChat(userId: string, userEmail: string): Promise<void> {
  let url: string | undefined = this.deltaStore.getDeltaLink(userId, 'teams')
    ?? `/users/${userId}/chats/getAllMessages/delta`;

  let deltaLink: string | undefined;

  while (url) {
    const response: GraphDeltaResponse<GraphChatMessage> =
      await this.graphClient.api(url).get();

    for (const msg of response.value) {
      if (msg.messageType !== 'message') continue;
      const capture: RawCapture = {
        id: randomUUID(),
        userId,
        userEmail,
        sourceType: 'graph_teams',
        sourceApp: 'teams',
        capturedAt: msg.createdDateTime,
        rawContent: JSON.stringify({
          body: msg.body?.content,
          from: msg.from?.user?.displayName,
          chatId: msg.chatId,
        }),
        metadata: { messageId: msg.id },
      };
      this.publish(capture);
    }

    deltaLink = response['@odata.deltaLink'];
    url = response['@odata.nextLink'];
  }

  if (deltaLink) {
    this.deltaStore.setDeltaLink(userId, 'teams', deltaLink);
  }
}
```

- [ ] **Step 4: Wire retryWithBackoff into Graph API calls**

Import `retryWithBackoff` and `RetryableError` in `graph-poller.ts`. Wrap `this.graphClient.api(url).get()` calls in both methods:

```typescript
import { retryWithBackoff, RetryableError } from './graph-retry.js';

// Replace direct .get() calls with:
const response = await retryWithBackoff(
  async () => {
    try {
      return await this.graphClient.api(url!).get();
    } catch (err: any) {
      if (err.statusCode === 429 || err.statusCode === 503) {
        const retryAfter = parseInt(err.headers?.['retry-after'] || '0', 10);
        throw new RetryableError(err.statusCode, err.message, retryAfter || undefined);
      }
      throw err;
    }
  },
  { maxRetries: 3, baseDelayMs: 1000 },
);
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run tests/ingestion/graph-poller.test.ts`
Expected: PASS — all tests including pagination

- [ ] **Step 6: Commit**

```bash
git add src/ingestion/graph-poller.ts tests/ingestion/graph-poller.test.ts
git commit -m "feat: add Graph API pagination and retry support"
```

---

## Chunk 3: Concurrency Limiter + Metrics + Dead Letter

### Task 7: Concurrency limiter

**Files:**
- Create: `src/pipeline/concurrency-limiter.ts`
- Create: `tests/pipeline/concurrency-limiter.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/pipeline/concurrency-limiter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ConcurrencyLimiter } from '../../src/pipeline/concurrency-limiter.js';

describe('ConcurrencyLimiter', () => {
  it('executes task immediately when under limit', async () => {
    const limiter = new ConcurrencyLimiter(2);
    const result = await limiter.run(() => Promise.resolve('done'));
    expect(result).toBe('done');
  });

  it('limits concurrent executions', async () => {
    const limiter = new ConcurrencyLimiter(2);
    let running = 0;
    let maxRunning = 0;

    const task = () => new Promise<void>((resolve) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      setTimeout(() => { running--; resolve(); }, 50);
    });

    await Promise.all([
      limiter.run(task),
      limiter.run(task),
      limiter.run(task),
      limiter.run(task),
    ]);

    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('propagates errors from task', async () => {
    const limiter = new ConcurrencyLimiter(2);
    await expect(limiter.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });

  it('reports active count', async () => {
    const limiter = new ConcurrencyLimiter(2);
    expect(limiter.active).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline/concurrency-limiter.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// src/pipeline/concurrency-limiter.ts

export class ConcurrencyLimiter {
  private _active = 0;
  private waiting: Array<() => void> = [];

  constructor(private maxConcurrency: number) {}

  get active(): number {
    return this._active;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this._active >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }

    this._active++;
    try {
      return await fn();
    } finally {
      this._active--;
      const next = this.waiting.shift();
      if (next) next();
    }
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/pipeline/concurrency-limiter.test.ts`
Expected: PASS — all 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/concurrency-limiter.ts tests/pipeline/concurrency-limiter.test.ts
git commit -m "feat: add concurrency limiter for LLM calls"
```

---

### Task 8: Pipeline metrics

**Files:**
- Create: `src/pipeline/metrics.ts`
- Create: `tests/pipeline/metrics.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/pipeline/metrics.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PipelineMetrics } from '../../src/pipeline/metrics.js';

describe('PipelineMetrics', () => {
  let metrics: PipelineMetrics;

  beforeEach(() => {
    metrics = new PipelineMetrics();
  });

  it('starts with all counters at zero', () => {
    const snapshot = metrics.snapshot();
    expect(snapshot.processed_total).toBe(0);
    expect(snapshot.blocked_total).toBe(0);
    expect(snapshot.deduplicated_total).toBe(0);
    expect(snapshot.errors_total).toBe(0);
    expect(snapshot.last_poll_at).toBeNull();
  });

  it('increments counters', () => {
    metrics.recordProcessed();
    metrics.recordProcessed();
    metrics.recordBlocked();
    metrics.recordDeduplicated();
    metrics.recordError();

    const snapshot = metrics.snapshot();
    expect(snapshot.processed_total).toBe(2);
    expect(snapshot.blocked_total).toBe(1);
    expect(snapshot.deduplicated_total).toBe(1);
    expect(snapshot.errors_total).toBe(1);
  });

  it('records last poll time', () => {
    metrics.recordPoll();
    const snapshot = metrics.snapshot();
    expect(snapshot.last_poll_at).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline/metrics.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// src/pipeline/metrics.ts

export interface MetricsSnapshot {
  processed_total: number;
  blocked_total: number;
  deduplicated_total: number;
  errors_total: number;
  last_poll_at: string | null;
}

export class PipelineMetrics {
  private processed = 0;
  private blocked = 0;
  private deduplicated = 0;
  private errors = 0;
  private lastPollAt: string | null = null;

  recordProcessed(): void { this.processed++; }
  recordBlocked(): void { this.blocked++; }
  recordDeduplicated(): void { this.deduplicated++; }
  recordError(): void { this.errors++; }
  recordPoll(): void { this.lastPollAt = new Date().toISOString(); }

  snapshot(): MetricsSnapshot {
    return {
      processed_total: this.processed,
      blocked_total: this.blocked,
      deduplicated_total: this.deduplicated,
      errors_total: this.errors,
      last_poll_at: this.lastPollAt,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/pipeline/metrics.test.ts`
Expected: PASS — all 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/metrics.ts tests/pipeline/metrics.test.ts
git commit -m "feat: add pipeline metrics counters"
```

---

### Task 9: Wire limiter + metrics into processor

**Files:**
- Modify: `src/pipeline/processor.ts`
- Modify: `tests/pipeline/processor.test.ts`

- [ ] **Step 1: Add tests for limiter and metrics**

Add to `tests/pipeline/processor.test.ts`:

```typescript
import { PipelineMetrics } from '../../src/pipeline/metrics.js';
import { ConcurrencyLimiter } from '../../src/pipeline/concurrency-limiter.js';

// In beforeEach, add:
const metrics = new PipelineMetrics();
const limiter = new ConcurrencyLimiter(8);

// Update processor construction:
processor = new PipelineProcessor(
  mockExtractor, mockDeduplicator, mockVaultManager,
  mockNatsPublish, mockEngramIndex, metrics, limiter
);

// Add new test:
it('increments metrics on stored capture', async () => {
  await processor.process(capture);
  const snapshot = metrics.snapshot();
  expect(snapshot.processed_total).toBe(1);
});

it('increments blocked metric on pre-filter block', async () => {
  const sensitive: RawCapture = { ...capture, rawContent: JSON.stringify({ subject: 'Your Salary Review', body: 'details' }) };
  await processor.process(sensitive);
  expect(metrics.snapshot().blocked_total).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline/processor.test.ts`
Expected: FAIL — constructor signature changed

- [ ] **Step 3: Update processor to accept limiter + metrics**

Update `src/pipeline/processor.ts` constructor and process method:

```typescript
import type { ConcurrencyLimiter } from './concurrency-limiter.js';
import type { PipelineMetrics } from './metrics.js';

export class PipelineProcessor {
  constructor(
    private extractor: Extractor,
    private deduplicator: Deduplicator,
    private vaultManager: VaultManager,
    private publishToNats: (topic: string, data: unknown) => void,
    private engramIndex?: EngramIndex,
    private metrics?: PipelineMetrics,
    private limiter?: ConcurrencyLimiter,
  ) {}

  async process(capture: RawCapture): Promise<ProcessResult> {
    // Stage 1: Sensitivity pre-filter
    const filterResult = sensitivityPreFilter(capture);
    if (filterResult.action === 'block') {
      this.metrics?.recordBlocked();
      return { action: 'blocked', reason: `pre-filter: ${filterResult.reason}` };
    }

    // Stage 2: Dedup
    if (this.deduplicator.isDuplicate(capture.userId, capture.rawContent)) {
      this.metrics?.recordDeduplicated();
      return { action: 'deduplicated' };
    }

    // Stage 3: LLM extraction (with concurrency limit)
    const extraction = this.limiter
      ? await this.limiter.run(() => this.extractor.extract(capture))
      : await this.extractor.extract(capture);

    // Stage 4: LLM sensitivity gate
    if (extraction.sensitivity.classification === 'block') {
      this.metrics?.recordBlocked();
      return { action: 'blocked', reason: `llm: ${extraction.sensitivity.reasoning}` };
    }

    // Stage 5: Build + store
    const engram = buildEngram(capture, extraction);
    await this.vaultManager.storePending(engram);

    if (this.engramIndex) {
      this.engramIndex.upsert({
        id: capture.id, userId: capture.userId,
        concept: engram.concept, approvalStatus: engram.approval_status,
        capturedAt: engram.captured_at, sourceType: engram.source_type,
        confidence: engram.confidence,
      });
    }

    // Stage 6: Notify
    this.publishToNats(topicForUser(capture.userId), engram);
    this.metrics?.recordProcessed();
    return { action: 'stored' };
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/pipeline/processor.test.ts`
Expected: PASS — all tests including new metrics tests

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/processor.ts tests/pipeline/processor.test.ts
git commit -m "feat: wire concurrency limiter and metrics into processor"
```

---

### Task 10: Dead letter + enriched health + main.ts wiring

**Files:**
- Modify: `src/api/server.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Update server.ts health endpoint**

Replace the simple health route with:

```typescript
// Add to ServerDeps:
metrics?: PipelineMetrics;
natsClient?: NatsClient;
config?: { llmBaseUrl: string; muninndbUrl: string };

// Replace health route:
app.get('/api/health', async () => {
  const services: Record<string, string> = {};

  // Check vLLM
  try {
    const llmUrl = deps.config?.llmBaseUrl || 'http://localhost:8000';
    const base = llmUrl.replace(/\/v1$/, '');
    const res = await fetch(`${base}/health`);
    services.vllm = res.ok ? 'healthy' : 'unhealthy';
  } catch { services.vllm = 'unreachable'; }

  // Check MuninnDB
  try {
    const res = await fetch(`${deps.config?.muninndbUrl || 'http://localhost:3030'}/health`);
    services.muninndb = res.ok ? 'healthy' : 'unhealthy';
  } catch { services.muninndb = 'unreachable'; }

  // NATS
  services.nats = deps.natsClient?.isConnected ? 'connected' : 'disconnected';

  return {
    status: 'ok',
    uptime_seconds: Math.floor(process.uptime()),
    services,
    pipeline: deps.metrics?.snapshot() ?? null,
  };
});
```

- [ ] **Step 2: Update main.ts with dead letter publishing, metrics, limiter, and real poll loop**

Key changes to `src/main.ts`:

```typescript
import { createAuthVerifier } from './api/auth.js';
import { PipelineMetrics } from './pipeline/metrics.js';
import { ConcurrencyLimiter } from './pipeline/concurrency-limiter.js';

// After loadConfig:
const authVerifier = createAuthVerifier({
  mode: config.auth.mode,
  devSecret: config.auth.devSecret,
  azureAdAudience: config.auth.azureAdAudience,
  azureTenantId: config.azure.tenantId,
});
const metrics = new PipelineMetrics();
const limiter = new ConcurrencyLimiter(config.maxConcurrentExtractions);

// Update processor:
const processor = new PipelineProcessor(
  extractor, deduplicator, vaultManager,
  (topic, data) => nats.publish(topic, data),
  engramIndex, metrics, limiter,
);

// Update NATS subscriber with dead letter:
nats.subscribe(TOPICS.RAW_CAPTURES, async (data) => {
  try {
    const capture = RawCaptureSchema.parse(data);
    const result = await processor.process(capture);
    console.log(`Processed ${capture.id}: ${result.action}`);
    if (result.action === 'stored') {
      wsManager.notify(capture.userId, { type: 'new_engram', captureId: capture.id });
    }
  } catch (err) {
    metrics.recordError();
    console.error('Pipeline error:', err);
    nats.publish(TOPICS.DEAD_LETTER, {
      capture: data,
      error: String(err),
      timestamp: new Date().toISOString(),
    });
  }
});

// Replace poll interval placeholder with real poll loop:
async function pollAllUsers() {
  try {
    const response = await graphClient.api('/users')
      .select('id,displayName,mail,department').get();
    const users = response.value ?? [];
    for (const user of users) {
      if (!user.mail) continue;
      try {
        await graphPoller.pollMail(user.id, user.mail);
        await graphPoller.pollTeamsChat(user.id, user.mail);
      } catch (err) {
        console.error(`Poll error for ${user.mail}:`, err);
      }
    }
    metrics.recordPoll();
  } catch (err) {
    console.error('User list fetch error:', err);
  }
}

await pollAllUsers();
const pollInterval = setInterval(pollAllUsers, config.pollIntervalMs);

// Pass metrics + nats + authVerifier to server:
const server = await createServer({
  muninnClient, vaultManager, engramIndex, wsManager,
  authVerifier, metrics, natsClient: nats,
});
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/api/server.ts src/main.ts
git commit -m "feat: add dead letter publishing, enriched health, and real poll loop"
```

---

## Chunk 4: Docker Deployment

### Task 11: Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

```
node_modules
dist
.env
*.db
.git
docs
tests
```

- [ ] **Step 2: Create Dockerfile**

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

- [ ] **Step 3: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add multi-stage Dockerfile for pipeline"
```

---

### Task 12: Docker Compose

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Create docker-compose.yml**

```yaml
services:
  nats:
    image: nats:2.10-alpine
    ports:
      - "4222:4222"
    volumes:
      - nats-data:/data
    command: ["--jetstream", "--store_dir=/data"]
    healthcheck:
      test: ["CMD", "nats-server", "--health"]
      interval: 10s
      timeout: 5s
      retries: 3

  vllm:
    image: vllm/vllm-openai:latest
    ports:
      - "8000:8000"
    volumes:
      - model-cache:/root/.cache/huggingface
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    command:
      - --model=meta-llama/Llama-3.1-8B-Instruct-AWQ
      - --quantization=awq
      - --max-model-len=4096
      - --gpu-memory-utilization=0.85
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 120s

  muninndb:
    image: muninndb:latest
    ports:
      - "3030:3030"
    volumes:
      - muninndb-data:/data
    environment:
      - MUNINNDB_API_KEY=${MUNINNDB_API_KEY}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3030/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  pipeline:
    build: .
    ports:
      - "3001:3001"
    depends_on:
      nats:
        condition: service_healthy
      vllm:
        condition: service_healthy
      muninndb:
        condition: service_healthy
    env_file: .env
    environment:
      - NATS_URL=nats://nats:4222
      - MUNINNDB_URL=http://muninndb:3030
      - LLM_BASE_URL=http://vllm:8000/v1
      - LLM_MODEL=meta-llama/Llama-3.1-8B-Instruct-AWQ
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/health"]
      interval: 10s
      timeout: 5s
      retries: 3

volumes:
  nats-data:
  model-cache:
  muninndb-data:
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add Docker Compose with NATS, vLLM, MuninnDB, and pipeline"
```

---

### Task 13: Verify build and full test suite

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify Docker build**

Run: `docker build -t knowledge-harvester-pipeline .`
Expected: Builds successfully

- [ ] **Step 4: Final commit if needed**

```bash
git add -A
git commit -m "chore: fix any remaining build issues"
```
