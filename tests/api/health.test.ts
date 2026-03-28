import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// Mock the logger before importing server — Fastify 5 rejects pino instances
// passed as `logger` (expects a config object or `loggerInstance`).
vi.mock('../../src/config/logger.js', () => ({
  logger: {
    child: () => false, // false disables Fastify logging in tests
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { createServer, type ServerDeps } from '../../src/api/server.js';
import { EngramIndex } from '../../src/storage/engram-index.js';
import { AuditStore } from '../../src/storage/audit-store.js';
import { UserStore } from '../../src/storage/user-store.js';
import { SettingsStore } from '../../src/storage/settings-store.js';
import { DeadLetterStore } from '../../src/storage/dead-letter-store.js';
import { WebSocketManager } from '../../src/api/ws.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

function tmpDb(name: string): string {
  return path.join(os.tmpdir(), `health-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('GET /api/health', () => {
  const dbPaths: string[] = [];
  let wsManager: WebSocketManager;

  function trackDb(p: string): string {
    dbPaths.push(p);
    return p;
  }

  afterEach(() => {
    wsManager?.close();
    for (const p of dbPaths) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
      try { fs.unlinkSync(p + '-wal'); } catch { /* ignore */ }
      try { fs.unlinkSync(p + '-shm'); } catch { /* ignore */ }
    }
    dbPaths.length = 0;
  });

  async function buildServer(overrides?: Partial<ServerDeps>) {
    wsManager = new WebSocketManager();
    const engramIndex = new EngramIndex(trackDb(tmpDb('engram')));
    const auditStore = new AuditStore(trackDb(tmpDb('audit')));
    const userStore = new UserStore(trackDb(tmpDb('user')));
    const settingsStore = new SettingsStore(trackDb(tmpDb('settings')));
    const deadLetterStore = new DeadLetterStore(trackDb(tmpDb('deadletter')));

    const deps: ServerDeps = {
      muninnClient: { recall: vi.fn() } as any,
      vaultManager: {} as any,
      engramIndex,
      wsManager,
      authVerifier: vi.fn(),
      auditStore,
      userStore,
      settingsStore,
      deadLetterStore,
      ...overrides,
    };

    const app = await createServer(deps);
    return { app, engramIndex, auditStore, userStore, settingsStore, deadLetterStore };
  }

  it('returns ok status with all databases healthy', async () => {
    const { app } = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    expect(body.databases).toBeDefined();
    expect(body.databases.engramIndex).toBe(true);
    expect(body.databases.auditStore).toBe(true);
    expect(body.databases.userStore).toBe(true);
    expect(body.databases.settingsStore).toBe(true);
    expect(body.databases.deadLetterStore).toBe(true);
  });

  it('returns degraded when a database ping fails', async () => {
    const { app, auditStore } = await buildServer();

    // Close the audit DB to simulate corruption / lock
    auditStore.close();

    const res = await app.inject({ method: 'GET', url: '/api/health' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('degraded');
    expect(body.databases.auditStore).toBe(false);
    // Other databases should still be healthy
    expect(body.databases.engramIndex).toBe(true);
  });

  it('includes checks and databases keys in response shape', async () => {
    const { app } = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    const body = JSON.parse(res.body);

    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('checks');
    expect(body).toHaveProperty('databases');
    expect(body).toHaveProperty('metrics');
    expect(typeof body.checks).toBe('object');
    expect(typeof body.databases).toBe('object');
  });

  it('omits optional stores from databases when not provided', async () => {
    const { app } = await buildServer({
      auditStore: undefined,
      userStore: undefined,
      settingsStore: undefined,
      deadLetterStore: undefined,
    });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    const body = JSON.parse(res.body);

    expect(body.databases.engramIndex).toBe(true);
    expect(body.databases.auditStore).toBeUndefined();
    expect(body.databases.userStore).toBeUndefined();
    expect(body.databases.settingsStore).toBeUndefined();
    expect(body.databases.deadLetterStore).toBeUndefined();
  });

  it('completes within 500ms', async () => {
    const { app } = await buildServer();
    const start = performance.now();
    await app.inject({ method: 'GET', url: '/api/health' });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
  });
});
