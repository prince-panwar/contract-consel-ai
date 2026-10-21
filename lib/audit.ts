import { getDb } from "./db/mongo";
import { clientIp } from "./auth/rateLimit";

// Append-only record of security-relevant actions: who signed in, viewed,
// exported, changed or deleted what. Contract content is never written here,
// and neither are filenames or search terms (they can identify the client).

export type AuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "auth.mfa_failed"
  | "auth.logout"
  | "account.password_changed"
  | "account.2fa_enabled"
  | "account.2fa_disabled"
  | "user.created"
  | "user.updated"
  | "user.password_reset"
  | "user.2fa_reset"
  | "report.uploaded"
  | "report.viewed"
  | "report.pdf_viewed"
  | "report.exported"
  | "report.deleted"
  | "report.shared"
  | "report.searched"
  | "report.ai_find"
  | "extraction.started"
  | "extraction.resumed"
  | "datapoint.added"
  | "datapoint.edited"
  | "datapoint.deleted";

export interface AuditEntry {
  ts: number;
  action: AuditAction;
  uid: string | null;
  email: string | null;
  reportId?: string;
  detail?: Record<string, string | number | boolean>;
  ip: string;
}

const RETENTION_DAYS = 400;
const globalForAudit = globalThis as unknown as { __ccAuditReady?: Promise<unknown> };

async function auditCollection() {
  const col = (await getDb()).collection<AuditEntry>("audit_log");
  globalForAudit.__ccAuditReady ??= Promise.all([
    col.createIndex({ ts: -1 }),
    col.createIndex({ uid: 1, ts: -1 }),
    col.createIndex({ reportId: 1, ts: -1 }),
    col.createIndex({ tsDate: 1 }, { expireAfterSeconds: RETENTION_DAYS * 86400 }),
  ]).catch((err) => {
    globalForAudit.__ccAuditReady = undefined;
    console.error("[audit] index setup failed:", err);
  });
  await globalForAudit.__ccAuditReady;
  return col;
}

/** Record an action. Never throws: auditing must not break the request. */
export async function audit(
  request: Request | null,
  actor: { uid: string; email: string } | null,
  action: AuditAction,
  extra: { reportId?: string; detail?: AuditEntry["detail"]; email?: string } = {},
): Promise<void> {
  try {
    const col = await auditCollection();
    await col.insertOne({
      ts: Date.now(),
      // Date copy drives the TTL index (retention).
      ...({ tsDate: new Date() } as object),
      action,
      uid: actor?.uid ?? null,
      email: actor?.email ?? extra.email ?? null,
      ...(extra.reportId ? { reportId: extra.reportId } : {}),
      ...(extra.detail ? { detail: extra.detail } : {}),
      ip: request ? clientIp(request) : "system",
    } as AuditEntry);
  } catch (err) {
    console.error("[audit] write failed:", err);
  }
}

export async function listAudit(filter: {
  uid?: string;
  action?: string;
  reportId?: string;
  before?: number;
  limit?: number;
}): Promise<AuditEntry[]> {
  const col = await auditCollection();
  const q: Record<string, unknown> = {};
  if (filter.uid) q.uid = filter.uid;
  if (filter.action) q.action = { $regex: `^${filter.action.replace(/[^a-z0-9_.]/gi, "")}` };
  if (filter.reportId) q.reportId = filter.reportId;
  if (filter.before) q.ts = { $lt: filter.before };
  return col
    .find(q, { projection: { _id: 0, tsDate: 0 } })
    .sort({ ts: -1 })
    .limit(Math.min(filter.limit ?? 100, 500))
    .toArray();
}
