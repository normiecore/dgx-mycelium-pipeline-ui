import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { captureRoutes } from '../../src/api/routes/captures.js';

describe('capture routes', () => {
  const mockNatsClient = {
    publish: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
  };

  async function buildApp() {
    const app = Fastify({ logger: false });
    await app.register(captureRoutes, { natsClient: mockNatsClient as any });
    return app;
  }

  it('accepts valid capture and publishes to NATS', async () => {
    const app = await buildApp();
    mockNatsClient.publish.mockClear();

    const payload = {
      id: 'cap-test-1',
      userId: 'user-1',
      userEmail: 'user@co.com',
      sourceType: 'desktop_window',
      sourceApp: 'knowledge-harvester-desktop',
      capturedAt: '2026-03-27T10:00:00Z',
      rawContent: JSON.stringify({ title: 'VS Code', owner: 'Code.exe' }),
      metadata: { captureType: 'window' },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/captures',
      payload,
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.accepted).toBe(true);
    expect(body.id).toBe('cap-test-1');
    expect(mockNatsClient.publish).toHaveBeenCalledOnce();
    expect(mockNatsClient.publish.mock.calls[0][0]).toBe('raw.captures');
  });

  it('rejects invalid payload with 400', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/captures',
      payload: { invalid: true },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain('Invalid capture payload');
  });

  it('accepts desktop screenshot captures', async () => {
    const app = await buildApp();
    mockNatsClient.publish.mockClear();

    const payload = {
      id: 'cap-ss-1',
      userId: 'user-1',
      userEmail: 'user@co.com',
      sourceType: 'desktop_screenshot',
      sourceApp: 'knowledge-harvester-desktop',
      capturedAt: '2026-03-27T10:00:10Z',
      rawContent: JSON.stringify({
        windowTitle: 'FEA Report.docx - Word',
        windowOwner: 'Microsoft Word',
        screenshotBase64: 'base64data',
        capturedAt: '2026-03-27T10:00:10Z',
      }),
      metadata: { captureType: 'screenshot' },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/captures',
      payload,
    });

    expect(res.statusCode).toBe(202);
    expect(mockNatsClient.publish).toHaveBeenCalledOnce();
  });
});
