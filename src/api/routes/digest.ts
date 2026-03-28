import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { EngramIndex } from '../../storage/engram-index.js';
import { generateDigest } from '../../pipeline/digest.js';
import { DigestQuerySchema } from '../schemas.js';

interface DigestRoutesOpts extends FastifyPluginOptions {
  engramIndex: EngramIndex;
}

export async function digestRoutes(
  app: FastifyInstance,
  opts: DigestRoutesOpts,
): Promise<void> {
  const { engramIndex } = opts;

  // GET /api/digest?period=daily|weekly
  app.get('/api/digest', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = (req as any).user;
    const digestParsed = DigestQuerySchema.safeParse(req.query);
    if (!digestParsed.success) {
      reply.code(400);
      const firstMessage = digestParsed.error.issues[0]?.message ?? 'Invalid query parameters';
      return { error: firstMessage, details: digestParsed.error.issues };
    }
    const { period } = digestParsed.data;

    try {
      const digest = generateDigest(engramIndex, user.userId, period);
      return digest;
    } catch (err) {
      req.log.error({ err }, 'Failed to generate digest');
      return reply.code(500).send({ error: 'Failed to generate digest' });
    }
  });
}
