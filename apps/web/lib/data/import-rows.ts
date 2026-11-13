// Row → wire mappers shared by the accounts and import DAL (phase-04 plan §7.1 RunView / LinkedAccountView, §8.11).
// Pure: the SQL returns enums as text and timestamps as Date (UTC `timestamp(3)`); JSON columns as parsed values.
import type { LinkedAccountView, RunView } from "@repo/contracts/http/accounts";
import { providerFromDb, toWire, type ProviderDb } from "@repo/contracts/http/p04-plain";
import { importErrorView, parseImportError, parseRatings, ratingsView } from "@repo/db/json";
import { linkViewStatus, type ImportStateDb, type LinkStatusDb } from "@/lib/accounts/view-status";
import { headlineOf } from "@/lib/accounts/preview";

const iso = (d: Date | string | null | undefined): string | null => (d === null || d === undefined ? null : new Date(d).toISOString());
const int = (n: number | bigint | string | null | undefined): number => (n === null || n === undefined ? 0 : Number(n));

/** The run columns every P4 statement selects (`r.` prefix-free names). */
export type RunRow = {
  referenceId: string;
  provider: ProviderDb;
  trigger: "INITIAL" | "MANUAL" | "DAILY" | "RETRY";
  status: "WAITING_FOR_MEMBERSHIP" | "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
  phase: string | null;
  seen: number;
  total: number | null;
  imported: number;
  skipped: number;
  analysisQueued: number;
  analysed: number;
  error: unknown;
  startedAt: Date | null;
  finishedAt: Date | null;
  updatedAt: Date;
};

export function toRunView(r: RunRow): RunView {
  const err = parseImportError(r.error);
  return {
    ref: r.referenceId,
    provider: providerFromDb(r.provider),
    trigger: toWire(r.trigger),
    status: toWire(r.status),
    phase: r.phase === "reading" || r.phase === "saving" ? r.phase : null,
    seen: int(r.seen),
    total: r.total === null || r.total === undefined ? null : int(r.total),
    imported: int(r.imported),
    skipped: int(r.skipped),
    analysisQueued: int(r.analysisQueued),
    analysed: int(r.analysed),
    error: err ? importErrorView(err) : null,
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
    updatedAt: iso(r.updatedAt)!,
  };
}

/** SQL fragment: the run columns of alias `r`, renamed with the `run_` prefix (LEFT JOIN rows may be all null). */
export const RUN_COLUMNS_AS_PREFIXED = `r."referenceId" AS "run_referenceId", r.provider::text AS run_provider,
  r.trigger::text AS run_trigger, r.status::text AS run_status, r.phase AS run_phase, r.seen AS run_seen, r.total AS run_total,
  r.imported AS run_imported, r.skipped AS run_skipped, r."analysisQueued" AS "run_analysisQueued", r.analysed AS run_analysed,
  r.error AS run_error, r."startedAt" AS "run_startedAt", r."finishedAt" AS "run_finishedAt", r."updatedAt" AS "run_updatedAt"`;

/** The `run_*` columns of a row back to a RunRow, or null when the LEFT JOIN found no run. */
export function runOfPrefixed(row: Record<string, unknown>): RunRow | null {
  if (row.run_referenceId === null || row.run_referenceId === undefined) return null;
  return {
    referenceId: row.run_referenceId as string,
    provider: row.run_provider as ProviderDb,
    trigger: row.run_trigger as RunRow["trigger"],
    status: row.run_status as RunRow["status"],
    phase: (row.run_phase as string | null) ?? null,
    seen: row.run_seen as number,
    total: (row.run_total as number | null) ?? null,
    imported: row.run_imported as number,
    skipped: row.run_skipped as number,
    analysisQueued: row.run_analysisQueued as number,
    analysed: row.run_analysed as number,
    error: row.run_error,
    startedAt: (row.run_startedAt as Date | null) ?? null,
    finishedAt: (row.run_finishedAt as Date | null) ?? null,
    updatedAt: row.run_updatedAt as Date,
  };
}

/** The linked_accounts columns of a LinkedAccountView (alias `la`). */
export const ACCOUNT_COLUMNS = `la.id, la.provider::text AS provider, la.username, la."displayName", la."avatarUrl", la.title,
  la.ratings, la."totalRatedGames", (la."verifiedAt" IS NOT NULL) AS verified, la.status::text AS status,
  la."importState"::text AS "importState", la."autoImport", la."lastSyncAt", la."lastSyncOkAt", la."nextAllowedSyncAt",
  la."nextAutoSyncAt", la."importedCount", la."skippedCount", la."lastError"`;

export type AccountRow = {
  id: bigint;
  provider: ProviderDb;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  title: string | null;
  ratings: unknown;
  totalRatedGames: number | null;
  verified: boolean;
  status: LinkStatusDb;
  importState: ImportStateDb;
  autoImport: boolean;
  lastSyncAt: Date | null;
  lastSyncOkAt: Date | null;
  nextAllowedSyncAt: Date | null;
  nextAutoSyncAt: Date | null;
  importedCount: number;
  skippedCount: number;
  lastError: unknown;
} & Record<string, unknown>;

export function toAccountView(row: AccountRow, now: Date, run: RunRow | null = runOfPrefixed(row)): LinkedAccountView {
  const provider = providerFromDb(row.provider);
  const ratings = ratingsView(parseRatings(row.ratings));
  const err = parseImportError(row.lastError);
  const nextAllowed = row.nextAllowedSyncAt ? new Date(row.nextAllowedSyncAt) : null;
  return {
    provider,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    title: row.title,
    ratings,
    headline: headlineOf(ratings, provider),
    totalRatedGames: row.totalRatedGames === null ? null : int(row.totalRatedGames),
    verified: Boolean(row.verified),
    status: linkViewStatus({ status: row.status, importState: row.importState, nextAllowedSyncAt: nextAllowed }, now),
    autoImport: Boolean(row.autoImport),
    lastSyncAt: iso(row.lastSyncAt),
    lastSyncOkAt: iso(row.lastSyncOkAt),
    nextAllowedSyncAt: iso(nextAllowed),
    nextAutoSyncAt: iso(row.nextAutoSyncAt),
    importedCount: int(row.importedCount),
    skippedCount: int(row.skippedCount),
    lastError: err ? importErrorView(err) : null,
    run: run ? withoutDuplicateError(toRunView(run), err ? importErrorView(err) : null) : null,
  };
}

/**
 * The account's newest run without its copy of the error the account already carries (`lastError`, written by the same
 * failure statement, worker run.ts failRunStatement). The account card reads `lastError`; nothing reads a run's error
 * from AccountsData. FIX-2, plan §9.6 "AccountsData (2 accounts) ≤ 2.5 KB": two failed accounts sent each error twice.
 */
function withoutDuplicateError(run: RunView, lastError: RunView["error"]): RunView {
  if (!run.error || !lastError) return run;
  const same = run.error.code === lastError.code && run.error.at === lastError.at && run.error.retryAt === lastError.retryAt;
  return same ? { ...run, error: null } : run;
}
