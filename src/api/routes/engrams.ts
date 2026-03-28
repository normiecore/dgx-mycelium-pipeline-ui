import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { MuninnDBClient } from '../../storage/muninndb-client.js';
import type { VaultManager } from '../../storage/vault-manager.js';
import type { EngramIndex } from '../../storage/engram-index.js';
import type { WebSocketManager } from '../ws.js';
import type { UserCache } from '../../ingestion/user-cache.js';
import type { AuditStore } from '../../storage/audit-store.js';
import { VaultManager as VM } from '../../storage/vault-manager.js';
import {
  GetEngramsQuerySchema,
  GetEngramExportQuerySchema,
  EngramIdParamsSchema,
  PatchEngramBodySchema,
  BulkEngramBodySchema,
} from '../schemas.js';

interface EngramRoutesOpts extends FastifyPluginOptions {
  muninnClient: MuninnDBClient;
  vaultManager: VaultManager;
  engramIndex: EngramIndex;
  wsManager: WebSocketManager;
  userCache?: UserCache;
  auditStore?: AuditStore;
}

export async function engramRoutes(
  app: FastifyInstance,
  opts: EngramRoutesOpts,
): Promise<void> {
  const { muninnClient, vaultManager, engramIndex, wsManager, userCache, auditStore } = opts;

  app.get('/api/engrams', async (req, reply) => {
    const user = (req as any).user;
    const parsed = GetEngramsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const {
      status, q,
      limit: rawLimit, offset: rawOffset,
      source, from, to,
      confidence_min, confidence_max,
      department,
    } = parsed.data;
    const maxResults = Math.min(200, Math.max(1, rawLimit));
    const offsetNum = Math.max(0, rawOffset);

    // Check if any facet filters are active (beyond just status or q)
    const hasFacets = source || from || to || confidence_min !== undefined || confidence_max !== undefined || department || offsetNum;

    if (hasFacets || (status && q)) {
      // Use faceted query engine for any combination of filters
      const filters = {
        status,
        source,
        from,
        to,
        confidence_min,
        confidence_max,
        department,
        q,
        limit: maxResults,
        offset: offsetNum,
      };
      return engramIndex.queryFaceted(user.userId, filters);
    }

    if (status) {
      const engrams = engramIndex.listByStatus(user.userId, status, maxResults);
      return { engrams, total: engrams.length, limit: maxResults, offset: 0 };
    }

    if (q) {
      const vault = VM.personalVault(user.userId);

      // Hybrid search: run semantic (MuninnDB) and local FTS5 in parallel
      const [semanticResult, ftsResults] = await Promise.all([
        muninnClient.recall(vault, q).catch(() => ({ engrams: [] as Array<{ id: string; concept: string }> })),
        Promise.resolve(engramIndex.search(user.userId, q, maxResults)),
      ]);

      const semanticEngrams = semanticResult.engrams ?? [];

      // Merge: start with semantic results (better ranking), then append
      // FTS5 matches that were not already returned by semantic search.
      const seenIds = new Set<string>(semanticEngrams.map((e) => e.id));
      const merged = [...semanticEngrams];

      for (const ftsRow of ftsResults) {
        if (!seenIds.has(ftsRow.id)) {
          seenIds.add(ftsRow.id);
          merged.push({
            id: ftsRow.id,
            concept: ftsRow.concept,
          });
        }
      }

      const sliced = merged.slice(0, maxResults);
      return { engrams: sliced, total: merged.length, limit: maxResults, offset: 0 };
    }

    const engrams = engramIndex.listAll(user.userId, maxResults);
    return { engrams, total: engrams.length, limit: maxResults, offset: 0 };
  });

  app.get('/api/engrams/export', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = (req as any).user;
    const exportParsed = GetEngramExportQuerySchema.safeParse(req.query);
    if (!exportParsed.success) {
      return reply.code(400).send({ error: 'Invalid query parameters', details: exportParsed.error.issues });
    }
    const { format, status } = exportParsed.data;

    const MAX_EXPORT = 10000;
    const engrams = status
      ? engramIndex.listByStatus(user.userId, status, MAX_EXPORT)
      : engramIndex.listAll(user.userId, MAX_EXPORT);

    auditStore?.log({
      userId: user.userId,
      action: 'engram.export',
      resourceType: 'engram',
      details: JSON.stringify({ format, status: status ?? 'all', count: engrams.length }),
      ipAddress: req.ip,
    });

    if (format === 'csv') {
      const header = 'id,concept,source_type,confidence,tags,approval_status,captured_at';
      const escapeCsv = (val: string) => `"${String(val ?? '').replace(/"/g, '""')}"`;
      const rows = engrams.map((e) =>
        [
          escapeCsv(e.id),
          escapeCsv(e.concept),
          escapeCsv(e.sourceType),
          e.confidence,
          escapeCsv((e.tags ?? []).join(';')),
          escapeCsv(e.approvalStatus),
          escapeCsv(e.capturedAt),
        ].join(','),
      );
      const csv = [header, ...rows].join('\n');
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', 'attachment; filename="engrams-export.csv"');
      return csv;
    }

    return engrams;
  });

  app.get('/api/engrams/:id', async (req, reply) => {
    const user = (req as any).user;
    const paramsParsed = EngramIdParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: 'Invalid engram ID', details: paramsParsed.error.issues });
    }
    const { id } = paramsParsed.data;
    const result = await muninnClient.read(VM.personalVault(user.userId), id);

    // Enrich with related engrams (by shared tags) and local index metadata
    const related_engrams = engramIndex.findRelatedByTags(user.userId, id, 5);

    return {
      ...result,
      related_engrams,
      source_metadata: result.metadata ?? null,
    };
  });

  app.patch('/api/engrams/:id', async (req, reply) => {
    const user = (req as any).user;
    const paramsParsed = EngramIdParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: 'Invalid engram ID', details: paramsParsed.error.issues });
    }
    const { id } = paramsParsed.data;

    const bodyParsed = PatchEngramBodySchema.safeParse(req.body);
    if (!bodyParsed.success) {
      reply.code(400);
      return { error: 'approval_status must be "approved" or "dismissed"', details: bodyParsed.error.issues };
    }
    const { approval_status } = bodyParsed.data;

    const vault = VM.personalVault(user.userId);
    const existing = await muninnClient.read(vault, id);
    const engram = JSON.parse(existing.content);

    if (engram.user_id !== user.userId) {
      reply.code(403);
      return { error: 'Forbidden' };
    }

    engram.approval_status = approval_status;
    engram.approved_at = new Date().toISOString();
    engram.approved_by = user.userId;

    engramIndex.updateStatus(id, approval_status);

    if (approval_status === 'approved') {
      const department = userCache?.getDepartment(user.userId) ?? 'unassigned';
      await vaultManager.storeApproved(engram, department);
    } else {
      await muninnClient.remember(vault, existing.concept, JSON.stringify(engram));
    }

    wsManager.notify(user.userId, { type: 'engram_updated', id, status: approval_status });

    auditStore?.log({
      userId: user.userId,
      action: approval_status === 'approved' ? 'engram.approve' : 'engram.dismiss',
      resourceType: 'engram',
      resourceId: id,
      details: JSON.stringify({ approval_status }),
      ipAddress: req.ip,
    });

    return { status: 'ok', approval_status };
  });

  app.post('/api/engrams/bulk', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = (req as any).user;
    const bulkParsed = BulkEngramBodySchema.safeParse(req.body);
    if (!bulkParsed.success) {
      reply.code(400);
      // Map Zod issue paths to backward-compatible error messages
      const actionIssue = bulkParsed.error.issues.find((i) => i.path.includes('action'));
      const idsIssue = bulkParsed.error.issues.find((i) => i.path.includes('ids'));
      let errorMessage: string;
      if (idsIssue) {
        errorMessage = idsIssue.message.includes('non-empty') ? 'ids must be a non-empty array' : idsIssue.message;
      } else if (actionIssue) {
        errorMessage = 'action must be "approve" or "dismiss"';
      } else {
        errorMessage = bulkParsed.error.issues[0]?.message ?? 'Invalid request body';
      }
      return { error: errorMessage, details: bulkParsed.error.issues };
    }
    const { ids, action } = bulkParsed.data;

    const approvalStatus = action === 'approve' ? 'approved' : 'dismissed';
    let processed = 0;
    let failed = 0;

    for (const id of ids) {
      try {
        const vault = VM.personalVault(user.userId);
        const existing = await muninnClient.read(vault, id);
        const engram = JSON.parse(existing.content);

        if (engram.user_id !== user.userId) {
          failed++;
          continue;
        }

        engram.approval_status = approvalStatus;
        engram.approved_at = new Date().toISOString();
        engram.approved_by = user.userId;

        engramIndex.updateStatus(id, approvalStatus);

        if (approvalStatus === 'approved') {
          const department = userCache?.getDepartment(user.userId) ?? 'unassigned';
          await vaultManager.storeApproved(engram, department);
        } else {
          await muninnClient.remember(vault, existing.concept, JSON.stringify(engram));
        }

        wsManager.notify(user.userId, { type: 'engram_updated', id, status: approvalStatus });

        auditStore?.log({
          userId: user.userId,
          action: approvalStatus === 'approved' ? 'engram.approve' : 'engram.dismiss',
          resourceType: 'engram',
          resourceId: id,
          details: JSON.stringify({ approval_status: approvalStatus, bulk: true }),
          ipAddress: req.ip,
        });

        processed++;
      } catch {
        failed++;
      }
    }

    return { processed, failed };
  });
}
