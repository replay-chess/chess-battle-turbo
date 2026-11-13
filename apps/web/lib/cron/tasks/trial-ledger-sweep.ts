/**
 * Cron task `trial-ledger-sweep` (phase-04 plan §8.4.4, §11.2; FIX-2, billing review round 2): the backstop of the
 * trial-ledger write. The ledger row is written by the entitlement fan-out (lib/billing/fanout.ts step 3) inside
 * `after()`, and a fan-out step that fails is only logged: the webhook was already answered `applied`, so Dodo never
 * redelivers, and the trial was never recorded. A Gmail dot / +tag variant of the email (or, after P10's hard deletion,
 * the same email) could then take a second trial. Imports and the analysis backlog have backstops; the ledger had none.
 *
 * Daily: every member whose trial started in the last LEDGER_SWEEP_DAYS days (newest first, at most LEDGER_SWEEP_LIMIT)
 * is written again through the same merge as the fan-out (LEDGER_WRITE_SQL semantics: insert, or merge the handles;
 * `firstTrialAt` never moves), in ONE statement. Idempotent: a member already recorded changes nothing. The window is
 * wider than a day so a cron that missed runs (a deploy, an outage) still catches up.
 */
import { recordedHashes, type LedgerHandle } from "@/lib/billing/trial-ledger";
import type { CronTask } from "./index";

export const LEDGER_SWEEP_DAYS = 30;
export const LEDGER_SWEEP_LIMIT = 2_000;

export type SweepCandidate = { email: string; trialStartedAt: Date; handles: LedgerHandle[] };

/** The members whose trial started inside the window, with every linked handle (verified or not), one statement. */
export const LEDGER_SWEEP_CANDIDATES_SQL = `SELECT u.email, u."trialStartedAt",
       COALESCE((SELECT json_agg(json_build_object('provider', lower(la.provider::text), 'usernameLower', la."usernameLower",
                                                   'verified', la."verifiedAt" IS NOT NULL) ORDER BY la.id)
                   FROM linked_accounts la WHERE la."userId" = u.id), '[]'::json) AS handles
  FROM users u
 WHERE u."trialStartedAt" IS NOT NULL
   AND u."trialStartedAt" >= ($1::timestamptz AT TIME ZONE 'UTC') - make_interval(days => $2::int)
 ORDER BY u."trialStartedAt" DESC
 LIMIT $3`;

/**
 * The fan-out's merge for many rows at once: `$1` = [{e, h: [handle hashes], t}]. Returns how many rows were new
 * (a trial the fan-out had lost) and how many were swept.
 */
export const LEDGER_SWEEP_WRITE_SQL = `WITH src AS (
  SELECT x.e, ARRAY(SELECT jsonb_array_elements_text(x.h) ORDER BY 1) AS h, x.t
    FROM jsonb_to_recordset($1::jsonb) AS x(e text, h jsonb, t timestamp(3))
), w AS (
  INSERT INTO trial_ledger ("emailHash", "handleHashes", "firstTrialAt")
  SELECT DISTINCT ON (src.e) src.e, src.h, src.t FROM src ORDER BY src.e, src.t
  ON CONFLICT ("emailHash") DO UPDATE
    SET "handleHashes" = ARRAY(SELECT DISTINCT h FROM unnest(trial_ledger."handleHashes" || EXCLUDED."handleHashes") AS h ORDER BY h)
  RETURNING (xmax = 0) AS inserted
)
SELECT count(*) FILTER (WHERE inserted)::int AS inserted, count(*)::int AS swept FROM w`;

export interface LedgerSweepDb {
  candidates(now: Date): Promise<SweepCandidate[]>;
  write(rows: { e: string; h: string[]; t: string }[]): Promise<{ inserted: number; swept: number }>;
}

/** The rows the write statement takes (hashes only; HASH_PEPPER is read here, as in the fan-out). */
export function sweepRows(candidates: readonly SweepCandidate[], pepper?: string): { e: string; h: string[]; t: string }[] {
  return candidates.map((c) => {
    const { emailHash, handleHashes } = recordedHashes(c.email, c.handles, pepper);
    return { e: emailHash, h: handleHashes, t: c.trialStartedAt.toISOString() };
  });
}

const defaultDb: LedgerSweepDb = {
  async candidates(now) {
    const { prisma } = await import("@/lib/prisma");
    return prisma.$queryRawUnsafe<SweepCandidate[]>(LEDGER_SWEEP_CANDIDATES_SQL, now.toISOString(), LEDGER_SWEEP_DAYS, LEDGER_SWEEP_LIMIT);
  },
  async write(rows) {
    const { prisma } = await import("@/lib/prisma");
    const out = await prisma.$queryRawUnsafe<{ inserted: number; swept: number }[]>(LEDGER_SWEEP_WRITE_SQL, JSON.stringify(rows));
    return { inserted: Number(out[0]?.inserted ?? 0), swept: Number(out[0]?.swept ?? 0) };
  },
};

export function createTrialLedgerSweep(db: LedgerSweepDb = defaultDb, pepper?: string): CronTask {
  return {
    name: "trial-ledger-sweep",
    async run(ctx) {
      const candidates = await db.candidates(ctx.now);
      if (candidates.length === 0) return { count: 0, detail: { swept: 0, recovered: 0 } };
      const { inserted, swept } = await db.write(sweepRows(candidates, pepper));
      return { count: inserted, detail: { swept, recovered: inserted } };
    },
  };
}

export const trialLedgerSweep = createTrialLedgerSweep();
