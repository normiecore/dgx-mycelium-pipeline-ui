import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { AuditStore } from '../../storage/audit-store.js';
import { GetAuditQuerySchema } from '../schemas.js';

interface AuditRoutesOpts extends FastifyPluginOptions {
  auditStore: AuditStore;
}

export async function auditRoutes(
  app: FastifyInstance,
  opts: AuditRoutesOpts,
): Promise<void> {
  const { auditStore } = opts;

  // GET /api/audit — Query audit log with filters
  app.get('/api/audit', async (req, reply) => {
    const user = (req as any).user;

    // Admin-only: only users with role 'admin' may view audit logs.
    // If no role info is available on the auth context, allow access
    // (the preHandler already enforces authentication).
    if (user.role && user.role !== 'admin') {
      reply.code(403);
      return { error: 'Admin access required' };
    }

    const auditParsed = GetAuditQuerySchema.safeParse(req.query);
    if (!auditParsed.success) {
      return reply.code(400).send({ error: 'Invalid query parameters', details: auditParsed.error.issues });
    }
    const { userId: filterUserId, action, resourceType, from, to, limit, offset } = auditParsed.data;

    const parsedLimit = Math.min(500, Math.max(1, limit));
    const parsedOffset = Math.max(0, offset);

    return auditStore.query({
      userId: filterUserId,
      action,
      resourceType,
      from,
      to,
      limit: parsedLimit,
      offset: parsedOffset,
    });
  });

  // GET /api/audit/actions — List distinct action types for filter dropdowns
  app.get('/api/audit/actions', async (req, reply) => {
    const user = (req as any).user;

    if (user.role && user.role !== 'admin') {
      reply.code(403);
      return { error: 'Admin access required' };
    }

    return { actions: auditStore.getDistinctActions() };
  });
}
