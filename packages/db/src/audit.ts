// The audit_logs writer shared by the web (WEB/lib/audit.ts: link, unlink, co-claims, the duplicate-trial guard, every
// backfill) and the worker (`account.purged` after an IMPORT_PURGE) (phase-04 plan 6.1, 6.6; data-model 5.1, R-04).
//
// One INSERT per entry, append-only, no FK (rows outlive deleted users). PII rules: never an email, a token, a
// password or a secret anywhere in the row. `checkAuditEntry` enforces them: `strict` (dev, test, local, CI) throws
// AuditMetaError so a violating call site fails its tests; non-strict (production) drops the offending meta keys or
// values (and an email-looking targetId) and still writes the row, because losing the audit trail is worse.
import { Prisma } from "#generated";
import type { SqlClient } from "./live/types";

export const AUDIT_CATEGORIES = ["ACCOUNT", "BILLING", "ADMIN", "CONTENT", "TOURNAMENT", "MODERATION", "SYSTEM"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_ACTORS = ["USER", "ADMIN", "SYSTEM", "WORKER", "WEBHOOK"] as const;
export type AuditActor = (typeof AUDIT_ACTORS)[number];

/** JSON-safe meta (bigints are written as decimal strings). */
export type AuditMetaValue = string | number | boolean | null | bigint | AuditMetaValue[] | { [key: string]: AuditMetaValue };

export interface AuditEntry {
  category: AuditCategory;
  /** Dotted lower-case verb: "account.linked", "billing.duplicate_trial_cancelled", "backfill.linked_accounts". */
  action: string;
  actorKind: AuditActor;
  actorUserId?: bigint | null;
  /** "linked_account", "user", "subscription", … */
  targetType?: string | null;
  /** A referenceId, slug or provider id; never a raw email. */
  targetId?: string | null;
  requestId?: string | null;
  meta?: Record<string, AuditMetaValue> | null;
  /** Default the database clock (UTC). */
  at?: Date;
}

export class AuditMetaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditMetaError";
  }
}

export const AUDIT_ACTION_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
/** Keys that name a secret or contact detail. */
export const AUDIT_FORBIDDEN_KEY_RE = /email|token|password|secret/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** The serialised meta cap (a row is a pointer to what happened, not a payload store). */
export const AUDIT_META_MAX_BYTES = 4_096;

type Violation = { path: string; why: string };

function cleanMeta(value: AuditMetaValue, path: string, out: Violation[]): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    if (EMAIL_RE.test(value)) {
      out.push({ path, why: "value looks like an email" });
      return undefined;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => cleanMeta(v, `${path}[${i}]`, out)).filter((v) => v !== undefined);
  }
  if (value !== null && typeof value === "object") {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (AUDIT_FORBIDDEN_KEY_RE.test(k)) {
        out.push({ path: `${path}.${k}`, why: "forbidden key" });
        continue;
      }
      const cleaned = cleanMeta(v, `${path}.${k}`, out);
      if (cleaned !== undefined) obj[k] = cleaned;
    }
    return obj;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    out.push({ path, why: "non-finite number" });
    return undefined;
  }
  return value;
}

function bounded(name: string, value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (value.length > max) throw new AuditMetaError(`audit: ${name} is longer than ${max}`);
  return value;
}

/** The validated, PII-free entry (see the header). Throws AuditMetaError for a shape error in every mode. */
export interface CheckedAuditEntry {
  category: AuditCategory;
  action: string;
  actorKind: AuditActor;
  actorUserId: bigint | null;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  /** JSON-ready (bigints as strings), PII removed. */
  meta: Record<string, unknown> | null;
  at: Date | null;
}

export function checkAuditEntry(entry: AuditEntry, strict: boolean): CheckedAuditEntry {
  if (!(AUDIT_CATEGORIES as readonly string[]).includes(entry.category)) throw new AuditMetaError(`audit: unknown category ${entry.category}`);
  if (!(AUDIT_ACTORS as readonly string[]).includes(entry.actorKind)) throw new AuditMetaError(`audit: unknown actor ${entry.actorKind}`);
  if (entry.action.length > 64 || !AUDIT_ACTION_RE.test(entry.action)) throw new AuditMetaError(`audit: action "${entry.action}" must be dotted lower-case`);
  const violations: Violation[] = [];
  let targetId = bounded("targetId", entry.targetId, 64);
  if (targetId !== null && EMAIL_RE.test(targetId)) {
    violations.push({ path: "targetId", why: "looks like an email" });
    targetId = null;
  }
  const meta = entry.meta == null ? null : (cleanMeta(entry.meta, "meta", violations) as Record<string, unknown>);
  if (violations.length > 0 && strict) {
    throw new AuditMetaError(`audit ${entry.action}: ${violations.map((v) => `${v.path} (${v.why})`).join(", ")}`);
  }
  if (meta && Buffer.byteLength(JSON.stringify(meta), "utf8") > AUDIT_META_MAX_BYTES) {
    throw new AuditMetaError(`audit ${entry.action}: meta is larger than ${AUDIT_META_MAX_BYTES} bytes`);
  }
  if (entry.at && Number.isNaN(entry.at.getTime())) throw new AuditMetaError("audit: at is an invalid Date");
  return {
    category: entry.category,
    action: entry.action,
    actorKind: entry.actorKind,
    actorUserId: entry.actorUserId ?? null,
    targetType: bounded("targetType", entry.targetType, 32),
    targetId,
    requestId: bounded("requestId", entry.requestId, 40),
    meta,
    at: entry.at ?? null,
  };
}

/** One `INSERT INTO audit_logs` (embed it in a batch transaction, or send it over the worker's HTTP driver). */
export function auditSql(entry: AuditEntry, options: { strict?: boolean } = {}): Prisma.Sql {
  const e = checkAuditEntry(entry, options.strict ?? true);
  const at = e.at ? Prisma.sql`(${e.at.toISOString()}::timestamptz AT TIME ZONE 'UTC')` : Prisma.sql`(now() AT TIME ZONE 'UTC')`;
  return Prisma.sql`INSERT INTO audit_logs (at, category, action, "actorKind", "actorUserId", "targetType", "targetId", "requestId", meta)
VALUES (${at}, ${e.category}::"AuditCategory", ${e.action}, ${e.actorKind}::"AuditActor", ${e.actorUserId}::bigint,
        ${e.targetType}, ${e.targetId}, ${e.requestId}, ${e.meta === null ? null : JSON.stringify(e.meta)}::jsonb)`;
}

/** Writes one row through any Prisma client, transaction client or SqlClient. */
export async function writeAudit(db: SqlClient, entry: AuditEntry, options: { strict?: boolean } = {}): Promise<void> {
  await db.$executeRaw(auditSql(entry, options));
}
