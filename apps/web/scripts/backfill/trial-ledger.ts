/**
 * B9 trial-ledger backfill (phase-04 plan 6.6, 8.4; data-model 11.6). Every user who already used the free trial
 * (`trialStartedAt IS NOT NULL`) gets a `trial_ledger` row, so the one-trial-per-person rule survives the account's
 * deletion (P10) and a second account with the same normalised email is not offered another trial.
 *
 *   cd apps/web
 *   npx tsx scripts/backfill/trial-ledger.ts            # dry run: users with a used trial, how many rows are missing
 *   npx tsx scripts/backfill/trial-ledger.ts --apply    # inserts the missing rows in batches of 500, then verifies
 *
 * Row: `emailHash` = trialLedgerEmailHash(email) and `handleHashes` = handleHash(provider, usernameLower, verified)
 * of every linked account (verified and unverified, as the webhook writes them; plan 8.4 step 4), both from
 * WEB/lib/billing/trial-ledger.ts with HASH_PEPPER (required; never printed), `firstTrialAt` = `trialStartedAt`.
 * Run it after linked-accounts.ts so legacy Chess.com handles are included.
 *
 * Predicate: `INSERT … ON CONFLICT ("emailHash") DO NOTHING` (idempotent; a row the webhook wrote first is kept).
 * Verification: every user with a used trial has a ledger row for its email hash (`missing` = 0). Two accounts whose
 * emails normalise to the same address share one row, so the row count can be lower than the user count.
 * No email, hash or handle is printed. Guards and the audit row: ./p04-common.ts.
 */
import { Prisma } from "@repo/db";
import {
  BATCH_SIZE,
  eachBatch,
  isEntryPoint,
  openBackfillDb,
  parseBackfillArgs,
  recordBackfill,
  reportFailure,
  type BackfillDb,
} from "./p04-common";

/** WEB/lib/billing/trial-ledger.ts (WP-D) with HASH_PEPPER bound; injected so tests use a known pepper. */
export interface LedgerHasher {
  emailHash(email: string): string;
  handleHash(provider: "chesscom" | "lichess", usernameLower: string, verified: boolean): string;
}

interface TrialUserRow {
  id: bigint;
  email: string;
  trialStartedAt: Date;
  handles: { provider: "CHESSCOM" | "LICHESS"; usernameLower: string; verified: boolean }[] | null;
}

export interface LedgerRowInsert {
  emailHash: string;
  handleHashes: string[];
  firstTrialAt: string;
}

/** The ledger rows of one batch (pure). Users sharing a normalised email collapse into one row (earliest trial). */
export function ledgerRowsFor(users: readonly Omit<TrialUserRow, "id">[], hasher: LedgerHasher): LedgerRowInsert[] {
  const byHash = new Map<string, { handles: Set<string>; first: Date }>();
  for (const u of users) {
    const hash = hasher.emailHash(u.email);
    const entry = byHash.get(hash) ?? { handles: new Set<string>(), first: u.trialStartedAt };
    for (const h of u.handles ?? []) {
      entry.handles.add(hasher.handleHash(h.provider === "CHESSCOM" ? "chesscom" : "lichess", h.usernameLower, h.verified));
    }
    if (u.trialStartedAt < entry.first) entry.first = u.trialStartedAt;
    byHash.set(hash, entry);
  }
  return [...byHash].map(([emailHash, e]) => ({ emailHash, handleHashes: [...e.handles].sort(), firstTrialAt: e.first.toISOString() }));
}

function trialUsersSql(cursor: bigint, limit: number): Prisma.Sql {
  return Prisma.sql`
    SELECT u.id, u.email, (u."trialStartedAt" AT TIME ZONE 'UTC') AS "trialStartedAt",
           (SELECT jsonb_agg(jsonb_build_object('provider', la.provider, 'usernameLower', la."usernameLower",
                                                'verified', la."verifiedAt" IS NOT NULL) ORDER BY la.provider)
              FROM linked_accounts la WHERE la."userId" = u.id) AS handles
      FROM users u
     WHERE u.id > ${cursor} AND u."trialStartedAt" IS NOT NULL
     ORDER BY u.id LIMIT ${limit}`;
}

export function insertLedgerSql(rows: readonly LedgerRowInsert[]): Prisma.Sql {
  return Prisma.sql`
    WITH src AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x("emailHash" text, "handleHashes" jsonb, "firstTrialAt" timestamptz)),
    ins AS (
      INSERT INTO trial_ledger ("emailHash", "handleHashes", "firstTrialAt")
      SELECT s."emailHash", ARRAY(SELECT jsonb_array_elements_text(s."handleHashes")), (s."firstTrialAt" AT TIME ZONE 'UTC')
      FROM src s
      ON CONFLICT ("emailHash") DO NOTHING
      RETURNING 1)
    SELECT (SELECT count(*)::int FROM ins) AS inserted`;
}

async function presentHashes(db: BackfillDb, hashes: readonly string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const rows = await db.$queryRaw<{ h: string }[]>(Prisma.sql`
    SELECT "emailHash" AS h FROM trial_ledger WHERE "emailHash" = ANY(${[...hashes]}::text[])`);
  return new Set(rows.map((r) => r.h.trim()));
}

export interface TrialLedgerBackfillResult {
  apply: boolean;
  /** Users with a used trial. */
  trialUsers: number;
  /** Distinct email hashes among them. */
  addresses: number;
  /** Hashes that had no row before the run. */
  missingBefore: number;
  inserted: number;
  /** Hashes still without a row after the run (the verification: 0 after --apply). */
  missingAfter: number;
  /** Users with a used trial and at least one linked account (their handles go into the row). */
  withHandles: number;
  batches: number;
}

export async function runTrialLedgerBackfill(
  db: BackfillDb,
  opts: { apply: boolean; hasher: LedgerHasher; log?: (line: string) => void; batchSize?: number },
): Promise<TrialLedgerBackfillResult> {
  const log = opts.log ?? (() => {});
  const r: TrialLedgerBackfillResult = {
    apply: opts.apply,
    trialUsers: 0,
    addresses: 0,
    missingBefore: 0,
    inserted: 0,
    missingAfter: 0,
    withHandles: 0,
    batches: 0,
  };
  const seen = new Set<string>();
  r.batches = await eachBatch(async (cursor, n) => {
    const users = await db.$queryRaw<TrialUserRow[]>(trialUsersSql(cursor, n));
    r.trialUsers += users.length;
    r.withHandles += users.filter((u) => (u.handles?.length ?? 0) > 0).length;
    // A hash seen in an earlier batch was already handled there (inserted, or present).
    const rows = ledgerRowsFor(users, opts.hasher).filter((row) => !seen.has(row.emailHash));
    for (const row of rows) seen.add(row.emailHash);
    const present = await presentHashes(db, rows.map((row) => row.emailHash));
    const missing = rows.filter((row) => !present.has(row.emailHash));
    r.missingBefore += missing.length;
    if (opts.apply && missing.length > 0) {
      const res = await db.$queryRaw<{ inserted: number }[]>(insertLedgerSql(missing));
      r.inserted += res[0]!.inserted;
      log(`[trial-ledger] batch after users.id ${cursor}: ${res[0]!.inserted} row(s) inserted for ${users.length} user(s)`);
    }
    if (opts.apply) {
      const after = await presentHashes(db, rows.map((row) => row.emailHash));
      r.missingAfter += rows.filter((row) => !after.has(row.emailHash)).length;
    }
    return { last: users.at(-1)?.id ?? null, size: users.length };
  }, opts.batchSize ?? BATCH_SIZE);
  r.addresses = seen.size;
  if (!opts.apply) r.missingAfter = r.missingBefore;
  else {
    await recordBackfill(db, "trial_ledger", {
      trialUsers: r.trialUsers,
      addresses: r.addresses,
      missingBefore: r.missingBefore,
      inserted: r.inserted,
      missingAfter: r.missingAfter,
      withHandles: r.withHandles,
      batches: r.batches,
    });
  }
  return r;
}

async function main() {
  const { apply } = parseBackfillArgs(process.argv.slice(2));
  const log = (l: string) => console.log(l);
  log(`mode     ${apply ? "APPLY" : "dry run (no writes; pass --apply to write)"}`);
  if (!process.env.HASH_PEPPER) throw new Error("HASH_PEPPER is not set (export it from the target environment; it is never printed)");
  const { trialLedgerEmailHash, handleHash } = await import("../../lib/billing/trial-ledger");
  const hasher: LedgerHasher = {
    emailHash: (email) => trialLedgerEmailHash(email),
    handleHash: (provider, usernameLower, verified) => handleHash(provider, usernameLower, verified),
  };
  const { db } = await openBackfillDb(log);
  try {
    const r = await runTrialLedgerBackfill(db, { apply, hasher, log });
    log(`users with a used trial ${r.trialUsers} (${r.addresses} distinct addresses, ${r.withHandles} with linked accounts)`);
    log(`${apply ? "inserted" : "would insert"} ${apply ? r.inserted : r.missingBefore}; missing before ${r.missingBefore}`);
    if (apply) {
      log(`verify   emails without a ledger row: ${r.missingAfter}`);
      if (r.missingAfter !== 0) process.exitCode = 1;
    }
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("backfill/trial-ledger", err));
