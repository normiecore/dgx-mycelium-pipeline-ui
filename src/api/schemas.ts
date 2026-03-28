import { z } from 'zod';
import { APPROVAL_STATUSES } from '../types.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Coerce a query-string value to a positive integer, with a default. */
function queryInt(defaultVal: number) {
  return z
    .string()
    .optional()
    .transform((v) => {
      const n = parseInt(v || String(defaultVal), 10);
      return Number.isFinite(n) ? n : defaultVal;
    });
}

/** Coerce a query-string value to a non-negative float, or undefined. */
function queryFloat() {
  return z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : undefined;
    });
}

// ---------------------------------------------------------------------------
// Engram routes
// ---------------------------------------------------------------------------

export const GetEngramsQuerySchema = z.object({
  status: z.string().optional(),
  q: z.string().optional(),
  limit: queryInt(20),
  offset: queryInt(0),
  source: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  confidence_min: queryFloat(),
  confidence_max: queryFloat(),
  department: z.string().optional(),
});

export const GetEngramExportQuerySchema = z.object({
  format: z.string().optional().default('json'),
  status: z.string().optional(),
});

export const EngramIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const PatchEngramBodySchema = z
  .object({
    approval_status: z.enum(['approved', 'dismissed']),
  })
  .passthrough();

export const BulkEngramBodySchema = z.object({
  ids: z.array(z.string()).min(1, 'ids must be a non-empty array').max(100, 'ids array must not exceed 100 items'),
  action: z.enum(['approve', 'dismiss'], {
    message: 'action must be "approve" or "dismiss"',
  }),
});

// ---------------------------------------------------------------------------
// Analytics routes
// ---------------------------------------------------------------------------

export const AnalyticsVolumeQuerySchema = z.object({
  period: z.string().optional(),
});

export const AnalyticsTopTagsQuerySchema = z.object({
  limit: queryInt(20),
});

// ---------------------------------------------------------------------------
// Users routes
// ---------------------------------------------------------------------------

export const GetUsersQuerySchema = z.object({
  page: queryInt(1),
  limit: queryInt(20),
  department: z.string().optional(),
  q: z.string().optional(),
});

export const UserIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const PatchUserBodySchema = z
  .object({
    department: z.string().optional(),
    role: z.string().optional(),
    harvestingEnabled: z.boolean().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Vaults routes
// ---------------------------------------------------------------------------

export const VaultNameParamsSchema = z.object({
  name: z.string().min(1),
});

export const VaultEngramsQuerySchema = z.object({
  limit: queryInt(20),
  offset: queryInt(0),
  q: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Settings routes
// ---------------------------------------------------------------------------

export const PatchSettingsBodySchema = z
  .object({
    notificationNewEngram: z.unknown().optional(),
    notificationSound: z.unknown().optional(),
    autoApproveConfidence: z.unknown().optional(),
    theme: z.unknown().optional(),
    itemsPerPage: z.unknown().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Audit routes
// ---------------------------------------------------------------------------

export const GetAuditQuerySchema = z.object({
  userId: z.string().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: queryInt(50),
  offset: queryInt(0),
});

// ---------------------------------------------------------------------------
// Dead-letters routes
// ---------------------------------------------------------------------------

export const DeadLetterIdParamsSchema = z.object({
  id: z
    .string()
    .transform((v) => parseInt(v, 10))
    .refine((n) => !isNaN(n), { message: 'Invalid ID' }),
});

// ---------------------------------------------------------------------------
// Timeline routes
// ---------------------------------------------------------------------------

export const TimelineQuerySchema = z.object({
  date: z.string().optional(),
  userId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Digest routes
// ---------------------------------------------------------------------------

export const DigestQuerySchema = z.object({
  period: z.enum(['daily', 'weekly'], {
    message: 'period must be "daily" or "weekly"',
  }),
});
