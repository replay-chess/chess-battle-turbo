// audit(): one audit_logs row (phase-04 plan 6.1, 6.6; data-model 5.1, consistency R-04: moved from P12 to P4, its
// first writer). Used by the account link and unlink routes, the co-claim note, the webhook's duplicate-trial guard
// and every backfill. The statement and the PII rules live in @repo/db/audit (the worker writes `account.purged`
// through the same builder).
//
//   await audit(tx, { category: "ACCOUNT", action: "account.linked", actorKind: "USER", actorUserId: viewer.id,
//                     targetType: "linked_account", targetId: "chesscom", requestId: ctx.requestId, meta: { verified } });
//
// `tx` is a Prisma transaction client (the row commits or rolls back with the change it records) or null for the
// shared client (from `after()`). PII: a meta key matching /email|token|password|secret/i at any depth, an
// email-looking value or an email-looking targetId throws AuditMetaError everywhere except a production build,
// where it is dropped (and logged) so the trail is never lost. Server-only.
import { AuditMetaError, checkAuditEntry, writeAudit, type AuditEntry } from "@repo/db/audit";
import { isProductionApp } from "./env";
import { logger } from "./logger";

export type { AuditActor, AuditCategory, AuditEntry, AuditMetaValue } from "@repo/db/audit";
export { AuditMetaError } from "@repo/db/audit";

/** Anything that can run one raw statement: the Prisma client, an interactive-transaction client, a test fake. */
export type AuditDb = Parameters<typeof writeAudit>[0];

/** Strict (throw on PII) everywhere but a production build. */
export function auditIsStrict(appEnv: string | undefined = process.env.NEXT_PUBLIC_APP_ENV): boolean {
  return !isProductionApp(appEnv);
}

export async function audit(tx: AuditDb | null, entry: AuditEntry, options: { appEnv?: string } = {}): Promise<void> {
  const strict = auditIsStrict(options.appEnv ?? process.env.NEXT_PUBLIC_APP_ENV);
  if (!strict) {
    try {
      checkAuditEntry(entry, true);
    } catch (error) {
      // PII is dropped by the lenient write below; a shape error throws there again.
      if (error instanceof AuditMetaError) logger.warn("audit.pii_dropped", { action: entry.action.slice(0, 64) });
    }
  }
  // The shared client goes through rawDb(): Next bundles @repo/db's Prisma.Sql apart from lib/prisma's runtime copy.
  const db: AuditDb = tx ?? (await import("./games/snapshot.server")).rawDb((await import("./prisma")).prisma);
  await writeAudit(db, entry, { strict });
}
