/**
 * B6 onboarding backfill (phase-04 plan 6.6; data-model 11.6 B6). Users who finished the legacy onboarding
 * (`onboarded = true`) still have M4's default `onboardingStep = WELCOME`; onboarding v3's resolver would send them
 * back to Welcome. This sets `onboardingStep = DONE` and `onboardedAt = "updatedAt"` (the best time we have; an
 * existing `onboardedAt` is kept). `updatedAt` itself is not touched.
 *
 *   cd apps/web
 *   npx tsx scripts/backfill/onboarding.ts            # dry run: how many users match, a sample of ids
 *   npx tsx scripts/backfill/onboarding.ts --apply    # writes in batches of 500, then verifies 0 rows match
 *
 * Predicate: `"onboardingStep" = 'WELCOME' AND onboarded` (idempotent: a written row no longer matches).
 * Verification: 0 rows match afterwards. Guards and the audit row: ./p04-common.ts.
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

export interface OnboardingBackfillResult {
  apply: boolean;
  /** Users matching the predicate before the run. */
  matched: number;
  updated: number;
  batches: number;
  /** Users matching after the run (the verification: 0 after --apply). */
  remaining: number;
  sampleIds: string[];
}

const PREDICATE = Prisma.sql`"onboardingStep" = 'WELCOME' AND onboarded`;

async function countMatching(db: BackfillDb): Promise<number> {
  const rows = await db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM users WHERE ${PREDICATE}`);
  return rows[0]?.n ?? 0;
}

/** One batch: the next ≤ limit matching ids after `cursor`, updated in the same statement. */
export function onboardingBatchSql(cursor: bigint, limit: number): Prisma.Sql {
  return Prisma.sql`
    WITH b AS (
      SELECT id FROM users WHERE id > ${cursor} AND ${PREDICATE} ORDER BY id LIMIT ${limit}
    ), u AS (
      UPDATE users SET "onboardingStep" = 'DONE', "onboardedAt" = COALESCE(users."onboardedAt", users."updatedAt")
        FROM b WHERE users.id = b.id AND users."onboardingStep" = 'WELCOME' AND users.onboarded
      RETURNING users.id)
    SELECT (SELECT max(id) FROM b) AS last, (SELECT count(*)::int FROM b) AS size, (SELECT count(*)::int FROM u) AS updated`;
}

export async function runOnboardingBackfill(
  db: BackfillDb,
  opts: { apply: boolean; log?: (line: string) => void; batchSize?: number },
): Promise<OnboardingBackfillResult> {
  const log = opts.log ?? (() => {});
  const limit = opts.batchSize ?? BATCH_SIZE;
  const matched = await countMatching(db);
  const sample = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT id FROM users WHERE ${PREDICATE} ORDER BY id LIMIT 10`);
  const result: OnboardingBackfillResult = {
    apply: opts.apply,
    matched,
    updated: 0,
    batches: 0,
    remaining: matched,
    sampleIds: sample.map((r) => r.id.toString()),
  };
  if (!opts.apply) return result;

  result.batches = await eachBatch(async (cursor, n) => {
    const rows = await db.$queryRaw<{ last: bigint | null; size: number; updated: number }[]>(onboardingBatchSql(cursor, n));
    const r = rows[0]!;
    result.updated += r.updated;
    if (r.size > 0) log(`[onboarding] batch after id ${cursor}: ${r.updated} of ${r.size} set to DONE`);
    return { last: r.last, size: r.size };
  }, limit);
  result.remaining = await countMatching(db);
  await recordBackfill(db, "onboarding", {
    matched: result.matched,
    updated: result.updated,
    batches: result.batches,
    remaining: result.remaining,
  });
  return result;
}

async function main() {
  const { apply } = parseBackfillArgs(process.argv.slice(2));
  const log = (l: string) => console.log(l);
  log(`mode     ${apply ? "APPLY" : "dry run (no writes; pass --apply to write)"}`);
  const { db } = await openBackfillDb(log);
  try {
    const r = await runOnboardingBackfill(db, { apply, log });
    log(`matched  ${r.matched} onboarded user(s) still at WELCOME${r.sampleIds.length ? ` (ids ${r.sampleIds.join(", ")}${r.matched > 10 ? ", …" : ""})` : ""}`);
    if (apply) {
      log(`updated  ${r.updated} in ${r.batches} batch(es); remaining ${r.remaining}`);
      if (r.remaining !== 0) {
        console.error("verification failed: users still match the predicate");
        process.exitCode = 1;
      }
    }
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("backfill/onboarding", err));
