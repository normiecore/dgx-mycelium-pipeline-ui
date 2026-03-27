import type { FastifyInstance } from 'fastify';
import type { DeadLetterStore } from '../../storage/dead-letter-store.js';
import type { NatsClient } from '../../queue/nats-client.js';
import { TOPICS } from '../../queue/topics.js';

interface DeadLetterRoutesOpts {
  deadLetterStore: DeadLetterStore;
  natsClient?: NatsClient;
}

export async function deadLetterRoutes(
  app: FastifyInstance,
  opts: DeadLetterRoutesOpts,
): Promise<void> {
  const { deadLetterStore, natsClient } = opts;

  app.get('/api/dead-letters', async () => {
    return {
      count: deadLetterStore.count(),
      items: deadLetterStore.list(50),
    };
  });

  app.delete<{ Params: { id: string } }>('/api/dead-letters/:id', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid ID' });
    deadLetterStore.delete(id);
    return { deleted: true };
  });

  app.post<{ Params: { id: string } }>('/api/dead-letters/:id/retry', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid ID' });

    if (!natsClient) {
      return reply.code(503).send({ error: 'NATS client unavailable' });
    }

    const record = deadLetterStore.get(id);
    if (!record) {
      return reply.code(404).send({ error: 'Dead letter not found' });
    }

    try {
      const payload = JSON.parse(record.payload);
      natsClient.publish(TOPICS.RAW_CAPTURES, payload);
      deadLetterStore.delete(id);
      return { status: 'requeued' };
    } catch (err) {
      return reply.code(500).send({ error: 'Failed to requeue dead letter' });
    }
  });
}
