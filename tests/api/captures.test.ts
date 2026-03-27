import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import Fastify from 'fastify';
import { EngramIndex } from '../../src/storage/engram-index.js';
import { captureRoutes } from '../../src/api/routes/captures.js';

function cleanupDb(path: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

const validImageCapture = {
  source: 'screen-main',
  content_type: 'image/png;base64',
  content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  captured_at: '2026-03-27T10:00:00Z',
};

const validTextCapture = {
  source: 'clipboard',
  content_type: 'text/plain',
  content: 'Some interesting text the user copied',
  captured_at: '2026-03-27T10:00:00Z',
};

describe('capture routes', () => {
  let dbPath: string;
  let engramIndex: EngramIndex;
  let mockNatsClient: any;

  beforeEach(() => {
    dbPath = join(tmpdir(), `capture-test-${randomUUID()}.db`);
    engramIndex = new EngramIndex(dbPath);

    mockNatsClient = {
      publish: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    };
  });

  afterEach(() => {
    engramIndex.close();
    cleanupDb(dbPath);
  });

  async function buildApp() {
    const app = Fastify();
    // Inject fake user on all requests (bypasses auth for route unit tests)
    app.decorateRequest('user', null);
    app.addHook('preHandler', async (req) => {
      (req as any).user = { userId: 'user-1', userEmail: 'alice@contoso.com' };
    });
    await app.register(captureRoutes, {
      natsClient: mockNatsClient,
      engramIndex,
    });
    return app;
  }

  async function buildAppNoAuth() {
    const app = Fastify();
    // No preHandler — simulate missing auth header returning 401
    app.addHook('preHandler', async (req, reply) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        reply.code(401).send({ error: 'Missing authorization header' });
      }
    });
    await app.register(captureRoutes, {
      natsClient: mockNatsClient,
      engramIndex,
    });
    return app;
  }

  it('POST /api/captures with image/png;base64 returns 202 queued', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/captures',
      payload: validImageCapture,
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(202);
    expect(body.status).toBe('queued');
    expect(typeof body.id).toBe('string');
    expect(body.id).toHaveLength(36); // UUID format
  });

  it('POST /api/captures with image/png;base64 publishes desktop_screenshot sourceType', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/captures',
      payload: validImageCapture,
    });

    expect(mockNatsClient.publish).toHaveBeenCalledTimes(1);
    const [topic, payload] = mockNatsClient.publish.mock.calls[0];
    expect(topic).toBe('raw.captures');
    const raw = JSON.parse(payload);
    expect(raw.sourceType).toBe('desktop_screenshot');
    expect(raw.sourceApp).toBe('mycelium-desktop');
    expect(raw.userId).toBe('user-1');
    expect(raw.userEmail).toBe('alice@contoso.com');
  });

  it('POST /api/captures with text/plain returns 202', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/captures',
      payload: validTextCapture,
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(202);
    expect(body.status).toBe('queued');
  });

  it('POST /api/captures with text/plain publishes desktop_text sourceType', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/captures',
      payload: validTextCapture,
    });

    const [, payload] = mockNatsClient.publish.mock.calls[0];
    const raw = JSON.parse(payload);
    expect(raw.sourceType).toBe('desktop_text');
  });

  it('POST /api/captures with missing required fields returns 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/captures',
      payload: { source: 'screen-main' }, // missing content_type, content, captured_at
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(400);
    expect(body.error).toBe('Invalid request body');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('POST /api/captures with invalid content_type returns 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/captures',
      payload: {
        source: 'screen',
        content_type: 'application/json', // not in enum
        content: 'data',
        captured_at: '2026-03-27T10:00:00Z',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /api/captures without auth returns 401', async () => {
    const app = await buildAppNoAuth();
    const res = await app.inject({
      method: 'POST',
      url: '/api/captures',
      payload: validImageCapture,
      // No authorization header
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Missing authorization header');
  });

  it('POST /api/captures when NATS unavailable returns 202 queued_local', async () => {
    mockNatsClient.publish = vi.fn().mockRejectedValue(new Error('NATS connection lost'));

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/captures',
      payload: validImageCapture,
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(202);
    expect(body.status).toBe('queued_local');
    expect(typeof body.id).toBe('string');
  });

  it('POST /api/captures queued_local still returns a valid id', async () => {
    mockNatsClient.publish = vi.fn().mockRejectedValue(new Error('timeout'));

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/captures',
      payload: validTextCapture,
    });
    const body = JSON.parse(res.body);

    expect(body.id).toHaveLength(36);
    expect(body.status).toBe('queued_local');
  });
});
