/**
 * B-W3 weakness recompute (phase-06 plan 6.6, 7.4.1): every member with at least PRELIMINARY_FROM (5) analysed human
 * games whose latest weakness snapshot is missing or older than ALGO_VERSION gets the one RECOMPUTE_WEAKNESS row
 * (`weakness:<userId>`) armed with trigger `algo` at JOB_PRIORITY.HOUSEKEEPING, `runAt` spread over 30 minutes, then
 * ONE kick of the worker's I/O lane. Run it after M6 and the worker build that handles RECOMPUTE_WEAKNESS are deployed
 * (and after B-W1, so the first build does not have to heal every row), and again after any ALGO_VERSION bump.
 *
 *   cd apps/web
 *   npx tsx scripts/backfill/enqueue-weakness-recompute.ts               # dry run: members that need a (re)build
 *   npx tsx scripts/backfill/enqueue-weakness-recompute.ts --apply       # arms their jobs in keyset batches of 500
 *   npx tsx scripts/backfill/enqueue-weakness-recompute.ts --verify      # after the drain: who still lacks a snapshot
 *   … --member <email>                                                   # only that member
 *
 * The statement per member is the shared §7.4.1 upsert (`@repo/db/weakness-jobs` enqueueWeaknessSql, the one the worker
 * and TR-12 run), so a pending row is coalesced (runAt never pushed back, priority never lowered) instead of
 * duplicated. Idempotent: a member whose job is QUEUED or RUNNING, or whose latest snapshot already has ALGO_VERSION,
 * is not a candidate, so a second --apply arms nothing. Done when --verify finds no member left (plan 6.6 B-W3).
 *
 * Rules: ./p04-common.ts and ./p06-common.ts. Runs on the Neon dev branch in stage B (owner action), never in stage A;
 * on production in P13.
 */
import { Prisma } from "@repo/db";
import { JOB_PRIORITY, weaknessDedupeKey } from "@repo/contracts/internal/jobs";
import { enqueueWeaknessSql } from "@repo/db/weakness-jobs";
import { ALGO_VERSION, PRELIMINARY_FROM } from "@repo/chess-training/weakness/constants";
import {
  BATCH_SIZE,
  isEntryPoint,
  openBackfillDb,
  parseBackfillArgs,
  reportFailure,
  type BackfillDb,
} from "./p04-common";
import { splitMemberArg } from "./enqueue-mistake-extraction";
import { kickWeakness, memberIdsOf, recordP6Backfill } from "./p06-common";

/** runAt is spread over this window (plan 7.4.1 "spread over 30 minutes"). */
export const SPREAD_SEC = 30 * 60;

export interface RecomputeScope {
  userIds?: readonly bigint[] | null;
  algoVersion?: number;
  minAnalysed?: number;
}

/**
 * Members who need a (re)build: ≥ minAnalysed analysed sides of human play (not BOT / LEGEND_BOT, not aborted), a
 * latest snapshot missing or below the algorithm version, and no RECOMPUTE_WEAKNESS row pending.
 */
export function needsRebuildSql(s: RecomputeScope): Prisma.Sql {
  const algo = s.algoVersion ?? ALGO_VERSION;
  const min = s.minAnalysed ?? PRELIMINARY_FROM;
  return Prisma.sql`
    (SELECT count(*) FROM game_players gp
      WHERE gp."userId" = u.id AND gp.accuracy IS NOT NULL AND gp.mode NOT IN ('BOT', 'LEGEND_BOT')
        AND gp.result IS DISTINCT FROM 'ABORTED') >= ${min}
    AND COALESCE((SELECT ws."algoVersion" FROM weakness_snapshots ws WHERE ws."userId" = u.id
                   ORDER BY ws."weekStart" DESC LIMIT 1), 0) < ${algo}
    AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j."dedupeKey" = 'weakness:' || u.id::text AND j.status IN ('QUEUED', 'RUNNING'))
    ${userScope(s)}`;
}

/** The member scope on users.id. */
function userScope(s: RecomputeScope): Prisma.Sql {
  return s.userIds && s.userIds.length > 0 ? Prisma.sql`AND u.id = ANY(${s.userIds.map((x) => x.toString())}::bigint[])` : Prisma.empty;
}

/** Dry-run count. */
export async function countRecomputeCandidates(db: BackfillDb, s: RecomputeScope = {}): Promise<number> {
  const rows = await db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM users u WHERE ${needsRebuildSql(s)}`);
  return rows[0]?.n ?? 0;
}

/** One keyset batch of candidate member ids after `after`. */
export function candidateIdsSql(after: bigint, limit: number, s: RecomputeScope = {}): Prisma.Sql {
  return Prisma.sql`SELECT u.id FROM users u WHERE u.id > ${after.toString()}::bigint AND ${needsRebuildSql(s)} ORDER BY u.id LIMIT ${limit}`;
}

/** The member's runAt: now + a stable offset in [0, SPREAD_SEC) (userId mod the window), so a re-run lands the same. */
export function spreadRunAt(userId: bigint, now: Date): Date {
  return new Date(now.getTime() + Number(userId % BigInt(SPREAD_SEC)) * 1000);
}

export interface RecomputeOutcome {
  batches: number;
  armed: number;
  earliest: Date | null;
}

/** --apply: arm every candidate's job through the shared upsert. */
export async function runEnqueueRecompute(
  db: BackfillDb,
  opts: RecomputeScope & { now?: Date; limit?: number; log?: (line: string) => void } = {},
): Promise<RecomputeOutcome> {
  const limit = opts.limit ?? BATCH_SIZE;
  const now = opts.now ?? new Date();
  const out: RecomputeOutcome = { batches: 0, armed: 0, earliest: null };
  let after = 0n;
  for (;;) {
    const ids = await db.$queryRaw<{ id: bigint }[]>(candidateIdsSql(after, limit, opts));
    if (ids.length === 0) break;
    for (const { id } of ids) {
      const runAt = spreadRunAt(BigInt(id), now);
      await db.$queryRaw(
        enqueueWeaknessSql({ userId: BigInt(id), trigger: "algo", priority: JOB_PRIORITY.HOUSEKEEPING, runAt, debounceSec: 0 }),
      );
      out.armed++;
      if (!out.earliest || runAt < out.earliest) out.earliest = runAt;
    }
    out.batches++;
    opts.log?.(`  batch ${out.batches}: ${ids.length} member(s) armed (e.g. ${weaknessDedupeKey(BigInt((ids[0] as { id: bigint }).id))})`);
    after = BigInt((ids[ids.length - 1] as { id: bigint }).id);
    if (ids.length < limit) break;
  }
  return out;
}

/** --verify: members with enough analysed games whose latest snapshot is still missing or old (pending jobs included). */
export async function countStillMissing(db: BackfillDb, s: RecomputeScope = {}): Promise<number> {
  const algo = s.algoVersion ?? ALGO_VERSION;
  const min = s.minAnalysed ?? PRELIMINARY_FROM;
  const rows = await db.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT count(*)::int AS n FROM users u
     WHERE (SELECT count(*) FROM game_players gp
             WHERE gp."userId" = u.id AND gp.accuracy IS NOT NULL AND gp.mode NOT IN ('BOT', 'LEGEND_BOT')
               AND gp.result IS DISTINCT FROM 'ABORTED') >= ${min}
       AND COALESCE((SELECT ws."algoVersion" FROM weakness_snapshots ws WHERE ws."userId" = u.id
                      ORDER BY ws."weekStart" DESC LIMIT 1), 0) < ${algo} ${userScope(s)}`);
  return rows[0]?.n ?? 0;
}

async function main(): Promise<void> {
  const { rest, member } = splitMemberArg(process.argv.slice(2));
  const cli = parseBackfillArgs(rest, ["--verify"]);
  const { db } = await openBackfillDb((l) => console.log(l));
  try {
    const userIds = await memberIdsOf(db, member);
    const scope: RecomputeScope = { userIds };
    console.log(`mode     ${cli.flags.has("--verify") ? "verify" : cli.apply ? "APPLY" : "dry run (pass --apply to write)"}`);
    console.log(`rule     ≥ ${PRELIMINARY_FROM} analysed human games, latest snapshot older than ALGO_VERSION ${ALGO_VERSION}, no pending job`);
    if (cli.flags.has("--verify")) {
      const left = await countStillMissing(db, scope);
      console.log(left === 0 ? "\nverified: every such member has a current snapshot." : `\nNOT verified: ${left} member(s) still without a current snapshot.`);
      if (left !== 0) process.exitCode = 1;
      return;
    }
    const n = await countRecomputeCandidates(db, scope);
    console.log(`found    ${n} member(s) to (re)build`);
    if (!cli.apply) {
      console.log("\ndry run: no writes.");
      return;
    }
    const r = await runEnqueueRecompute(db, { userIds, log: (l) => console.log(l) });
    await recordP6Backfill(db, "weakness_recompute", { armed: r.armed, batches: r.batches, algoVersion: ALGO_VERSION });
    console.log(`\napplied: ${r.armed} RECOMPUTE_WEAKNESS job(s) armed over ${r.batches} batch(es).`);
    if (r.armed > 0) console.log(await kickWeakness(process.env, fetch, Date.now()));
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("backfill/enqueue-weakness-recompute", err));
