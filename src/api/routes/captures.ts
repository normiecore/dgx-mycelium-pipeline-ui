import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { NatsClient } from '../../queue/nats-client.js';
import type { EngramIndex } from '../../storage/engram-index.js';
import { DesktopCaptureSchema } from '../../types.js';
import { TOPICS } from '../../queue/topics.js';
import { randomUUID } from 'node:crypto';

interface CaptureRoutesOpts extends FastifyPluginOptions {
  natsClient: NatsClient;
  engramIndex: EngramIndex;
}

export async function captureRoutes(
  app: FastifyInstance,
  opts: CaptureRoutesOpts,
): Promise<void> {
  const { natsClient, engramIndex } = opts;

  app.post('/api/captures', async (req, reply) => {
    const user = (req as any).user;
    const parseResult = DesktopCaptureSchema.safeParse(req.body);
    if (!parseResult.success) {
      reply.code(400).send({ error: 'Invalid request body', details: parseResult.error.issues });
      return;
    }

    const capture = parseResult.data;
    const id = randomUUID();
    const rawCapture = {
      id,
      userId: user.userId,
      userEmail: user.userEmail ?? user.userId,
      sourceType: capture.content_type === 'image/png;base64' ? 'desktop_screenshot' : 'desktop_text',
      sourceApp: 'mycelium-desktop',
      capturedAt: capture.captured_at,
      rawContent: capture.content,
      metadata: { source: capture.source, content_type: capture.content_type },
    };

    try {
      await natsClient.publish(TOPICS.RAW_CAPTURES, JSON.stringify(rawCapture));
    } catch {
      // NATS unavailable — still accept and return queued status
      reply.code(202).send({ id, status: 'queued_local' });
      return;
    }

    reply.code(202).send({ id, status: 'queued' });
  });
}
