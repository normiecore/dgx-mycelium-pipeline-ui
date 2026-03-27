import type { FastifyInstance } from 'fastify';
import type { DeadLetterStore } from '../../storage/dead-letter-store.js';

interface DeadLetterRoutesOpts {
  deadLetterStore: DeadLetterStore;
}

export async function deadLetterRoutes(
  app: FastifyInstance,
  opts: DeadLetterRoutesOpts,
): Promise<void> {
  const { deadLetterStore } = opts;

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
}
