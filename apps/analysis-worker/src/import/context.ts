// `loadImportContext` (phase-04 plan §7.7.2, §8.9, §9.4 "context 1 (incl. the budget count)"): ONE statement for
// everything an IMPORT_SYNC attempt needs before it calls a provider:
//
//   the linked account · its cursor · the member's entitlement columns, zone and ref · the run this job drives (the
//   payload's runId, else the account's active run) with the creation time of the run's newest saved game (the
//   Lichess cursor after a resumed attempt, §8.7 step 4) · the member's analysis budget used (imported games of both
//   providers whose analysis is queued, running or done).
//
// The worker role reads only the granted users columns (replay_worker.p4.sql: id, referenceId, gamesVersion and the
// entitlement columns + timeZone; never email, googleId or the billing identifiers), so nothing here selects `u.*`.
// Times come back as epoch ms (`extract(epoch …)`), int8 ids as strings.
import { ANALYSIS_MIN_PLIES } from "@repo/contracts/internal/jobs";
import type { ImportTriggerDb } from "@repo/contracts/internal/jobs";
import { parseArchives, type ArchivesV1 } from "@repo/db/json";
import { idOrNull, idStr, num, numOrNull, stmt, type Db, type Row, type Statement } from "../db/client";

export type ProviderDb = "CHESSCOM" | "LICHESS";
export type LinkStatusDb = "ACTIVE" | "ERROR" | "RELINK_REQUIRED";
export type ImportRunStatusDb = "WAITING_FOR_MEMBERSHIP" | "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
export const ACTIVE_RUN_STATUSES: readonly ImportRunStatusDb[] = ["WAITING_FOR_MEMBERSHIP", "QUEUED", "RUNNING"];

export interface ImportAccount {
  id: string;
  userId: string;
  provider: ProviderDb;
  externalId: string;
  username: string;
  usernameLower: string;
  title: string | null;
  status: LinkStatusDb;
  importState: string;
  autoImport: boolean;
  importedCount: number;
  skippedCount: number;
  lastSyncOkAtMs: number | null;
}

export interface ImportMember {
  userRef: string;
  timeZone: string;
  role: string;
  subscriptionStatus: string | null;
  currentPeriodEndMs: number | null;
  cancelAtPeriodEnd: boolean;
  trialStartedAtMs: number | null;
  trialEndsAtMs: number | null;
}

export interface ImportCursor {
  archivesEtag: string | null;
  archivesLastModified: string | null;
  archives: ArchivesV1;
  lichessSinceMs: number | null;
  lichessResumeUntilMs: number | null;
  seen: number;
  skippedVariants: number;
}

export interface ImportRunRow {
  id: string;
  ref: string;
  trigger: ImportTriggerDb;
  status: ImportRunStatusDb;
  seen: number;
  total: number | null;
  imported: number;
  skipped: number;
  analysisQueued: number;
  analysed: number;
  firstGameId: string | null;
  /** The run started reading before (an earlier attempt or a rate-limit pause, FIX-2): no second `import_started`. */
  everStarted: boolean;
  /** games."createdAt" of the run's first (newest) saved game: the provider's creation time for imports. */
  newestSavedCreatedMs: number | null;
}

export interface ImportContext {
  account: ImportAccount;
  member: ImportMember;
  /** null until the first run of the account created it (link-service / start). */
  cursor: ImportCursor | null;
  run: ImportRunRow | null;
  /** Imported games (both providers) whose analysis is queued, running or done: counts against IMPORT_ANALYSE_CAP. */
  budgetUsed: number;
  /**
   * An IMPORT_PURGE of this member and provider is QUEUED or RUNNING (`importpurge:<userId>:<provider>`): an unlink
   * with "delete games" followed by a re-link. The purge deletes by (member, source) with no cutoff, so the import
   * waits until it is over; otherwise it would remove the games this import saves.
   */
  purgePending: boolean;
}

const ms = (col: string) => `(extract(epoch FROM ${col}) * 1000)::float8`;

export function loadImportContextStatement(linkedAccountId: string, runId: string | null): Statement {
  return stmt(
    `SELECT la.id::text AS id, la."userId"::text AS "userId", la.provider::text AS provider, la."externalId",
        la.username, la."usernameLower", la.title, la.status::text AS status, la."importState"::text AS "importState",
        la."autoImport", la."importedCount", la."skippedCount", ${ms(`la."lastSyncOkAt"`)} AS "lastSyncOkAtMs",
        u."referenceId" AS "userRef", u."timeZone", u.role::text AS role, u."subscriptionStatus",
        ${ms(`u."currentPeriodEnd"`)} AS "currentPeriodEndMs", u."cancelAtPeriodEnd",
        ${ms(`u."trialStartedAt"`)} AS "trialStartedAtMs", ${ms(`u."trialEndsAt"`)} AS "trialEndsAtMs",
        (c."linkedAccountId" IS NOT NULL) AS "hasCursor", c."archivesEtag", c."archivesLastModified", c.archives,
        c."lichessSinceMs"::text AS "lichessSinceMs", c."lichessResumeUntilMs"::text AS "lichessResumeUntilMs",
        c.seen AS "cursorSeen", c."skippedVariants",
        r.id::text AS "runId", r."referenceId" AS "runRef", r.trigger::text AS "runTrigger", r.status::text AS "runStatus",
        r.seen AS "runSeen", r.total AS "runTotal", r.imported AS "runImported", r.skipped AS "runSkipped",
        r."analysisQueued" AS "runAnalysisQueued", r.analysed AS "runAnalysed", r."firstGameId"::text AS "runFirstGameId", (r."startedAt" IS NOT NULL) AS "runEverStarted",
        ${ms(`fg."createdAt"`)} AS "runNewestSavedCreatedMs",
        (SELECT count(*)::int FROM game_players gp JOIN games g ON g.id = gp."gameId"
          WHERE gp."userId" = la."userId" AND gp.source <> 'REPLAY' AND g."analysisStatus" <> 'NONE') AS "budgetUsed",
        EXISTS (SELECT 1 FROM jobs pj
          WHERE pj."dedupeKey" = 'importpurge:' || la."userId"::text || ':' || lower(la.provider::text)
            AND pj.status IN ('QUEUED', 'RUNNING')) AS "purgePending"
   FROM linked_accounts la
   JOIN users u ON u.id = la."userId"
   LEFT JOIN import_cursors c ON c."linkedAccountId" = la.id
   LEFT JOIN LATERAL (
     SELECT * FROM import_runs ir
      WHERE ir."linkedAccountId" = la.id
        AND (ir.id = $2::bigint OR ($2::bigint IS NULL AND ir.status IN ('WAITING_FOR_MEMBERSHIP', 'QUEUED', 'RUNNING')))
      ORDER BY ir.id DESC LIMIT 1) r ON true
   LEFT JOIN games fg ON fg.id = r."firstGameId"
  WHERE la.id = $1::bigint`,
    [linkedAccountId, runId],
  );
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const bool = (v: unknown): boolean => v === true || v === "t" || v === "true";
const bigMs = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function toImportContext(row: Row): ImportContext {
  const runId = idOrNull(row.runId);
  return {
    account: {
      id: idStr(row.id),
      userId: idStr(row.userId),
      provider: row.provider === "LICHESS" ? "LICHESS" : "CHESSCOM",
      externalId: String(row.externalId),
      username: String(row.username),
      usernameLower: String(row.usernameLower),
      title: str(row.title),
      status: (str(row.status) ?? "ACTIVE") as LinkStatusDb,
      importState: String(row.importState),
      autoImport: bool(row.autoImport),
      importedCount: num(row.importedCount),
      skippedCount: num(row.skippedCount),
      lastSyncOkAtMs: numOrNull(row.lastSyncOkAtMs),
    },
    member: {
      userRef: String(row.userRef),
      timeZone: str(row.timeZone) ?? "UTC",
      role: str(row.role) ?? "USER",
      subscriptionStatus: str(row.subscriptionStatus),
      currentPeriodEndMs: numOrNull(row.currentPeriodEndMs),
      cancelAtPeriodEnd: bool(row.cancelAtPeriodEnd),
      trialStartedAtMs: numOrNull(row.trialStartedAtMs),
      trialEndsAtMs: numOrNull(row.trialEndsAtMs),
    },
    cursor: bool(row.hasCursor)
      ? {
          archivesEtag: str(row.archivesEtag),
          archivesLastModified: str(row.archivesLastModified),
          archives: parseArchives(row.archives),
          lichessSinceMs: bigMs(row.lichessSinceMs),
          lichessResumeUntilMs: bigMs(row.lichessResumeUntilMs),
          seen: num(row.cursorSeen ?? 0),
          skippedVariants: num(row.skippedVariants ?? 0),
        }
      : null,
    run: runId
      ? {
          id: runId,
          ref: String(row.runRef),
          trigger: String(row.runTrigger) as ImportTriggerDb,
          status: String(row.runStatus) as ImportRunStatusDb,
          seen: num(row.runSeen),
          total: numOrNull(row.runTotal),
          imported: num(row.runImported),
          skipped: num(row.runSkipped),
          analysisQueued: num(row.runAnalysisQueued),
          analysed: num(row.runAnalysed),
          firstGameId: idOrNull(row.runFirstGameId),
          everStarted: bool(row.runEverStarted),
          newestSavedCreatedMs: numOrNull(row.runNewestSavedCreatedMs),
        }
      : null,
    budgetUsed: num(row.budgetUsed),
    purgePending: bool(row.purgePending),
  };
}

export async function loadImportContext(
  db: Db,
  linkedAccountId: string,
  runId: string | null,
): Promise<ImportContext | null> {
  const rows = await db.query(loadImportContextStatement(linkedAccountId, runId));
  return rows[0] ? toImportContext(rows[0]) : null;
}

// ── membership (the web's rules, lib/billing/entitlement-rules.ts isEntitled + lib/auth/membership.ts) ────────────
const GRACE_STATUSES = new Set(["on_hold", "past_due"]);

/** P1's `isEntitled` over the columns the worker may read. */
export function isEntitledMember(m: ImportMember, nowMs: number): boolean {
  const status = m.subscriptionStatus;
  if (!status) return false;
  if (status === "active") return true;
  const periodLeft = m.currentPeriodEndMs !== null && m.currentPeriodEndMs > nowMs;
  if (status === "cancelled") return m.cancelAtPeriodEnd && periodLeft;
  if (GRACE_STATUSES.has(status)) return periodLeft;
  return false;
}

/** The web's `member`: no paywall, an admin, or entitled. */
export function isMember(m: ImportMember, nowMs: number, paywall: boolean): boolean {
  return !paywall || m.role === "ADMIN" || isEntitledMember(m, nowMs);
}

/** P1's `isInTrial`: inside [trialStartedAt, trialEndsAt). */
export function isTrialing(m: ImportMember, nowMs: number): boolean {
  return (
    m.trialStartedAtMs !== null && m.trialEndsAtMs !== null && m.trialStartedAtMs <= nowMs && nowMs < m.trialEndsAtMs
  );
}

/** Games shorter than this are never queued for analysis (P3 skips them as `too_short`). */
export { ANALYSIS_MIN_PLIES };
