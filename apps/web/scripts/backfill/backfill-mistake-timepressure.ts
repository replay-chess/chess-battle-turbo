/**
 * B-W2 time-pressure tag backfill (phase-06 plan 6.6, 8.12): a bank mistake made with under a minute on the member's
 * clock carries the theme `rc:timePressure`, so the weakness drill for time pressure finds its own items. P6's
 * extraction (J1) tags new mistakes; this backfill tags the ones extracted before P6.
 *
 *   cd apps/web
 *   npx tsx scripts/backfill/backfill-mistake-timepressure.ts               # dry run: occurrences checked, mistakes to tag
 *   npx tsx scripts/backfill/backfill-mistake-timepressure.ts --apply       # tags them in keyset batches of 500
 *   … --member <email>                                                      # only that member's mistakes
 *
 * Per keyset batch over mistake_occurrences `(gameId, ply)` whose mistake is not tagged yet: one read (⋈ mistakes ⋈
 * games for the clocks), the clock before the occurrence's ply from `@repo/chess-analysis/clock` (the one rule STATS_V1,
 * ERROR_LOG_V1 and J1 share: `ply` is the offset from games."startPly", the mover is the member), then ONE
 * `UPDATE mistakes SET themes = array_append(themes, 'rc:timePressure') WHERE id = ANY($ids) AND NOT ('rc:timePressure'
 * = ANY(themes))`. A mistake seen in several games is tagged when any occurrence was under a minute. primaryTheme is
 * never changed (the key is never primary), so bank filters, mastery and theme_mastery.bankCount are unaffected. A
 * second --apply changes 0 rows (the predicate and the guard). The tag is a fact about the position as played, so
 * hidden mistakes are tagged too (a restore keeps it).
 *
 * Rules: ./p04-common.ts and ./p06-common.ts. Runs on the Neon dev branch in stage B (owner action), never in stage A;
 * on production in P13.
 */
import { Prisma } from "@repo/db";
import { isTimePressure } from "@repo/chess-analysis/clock";
import {
  BATCH_SIZE,
  isEntryPoint,
  openBackfillDb,
  parseBackfillArgs,
  reportFailure,
  type BackfillDb,
} from "./p04-common";
import { splitMemberArg } from "./enqueue-mistake-extraction";
import { memberIdsOf, memberScopeSql, recordP6Backfill } from "./p06-common";

/** The theme key (TRN themes.ts `rc:timePressure`; never primary, no shard bit). */
export const TIME_PRESSURE_THEME = "rc:timePressure";

export interface TimePressureScope {
  userIds?: readonly bigint[] | null;
}

const untagged = (s: TimePressureScope) =>
  Prisma.sql`NOT (${TIME_PRESSURE_THEME} = ANY(m.themes)) ${memberScopeSql("m", s.userIds)}`;

/** Dry-run counts: occurrences of untagged mistakes, and those mistakes. */
export async function countOccurrences(db: BackfillDb, s: TimePressureScope = {}): Promise<{ occurrences: number; mistakes: number }> {
  const rows = await db.$queryRaw<{ occurrences: number; mistakes: number }[]>(Prisma.sql`
    SELECT count(*)::int AS occurrences, count(DISTINCT o."mistakeId")::int AS mistakes
      FROM mistake_occurrences o JOIN mistakes m ON m.id = o."mistakeId"
     WHERE ${untagged(s)}`);
  return rows[0] ?? { occurrences: 0, mistakes: 0 };
}

export interface OccurrenceRow {
  gameId: bigint;
  ply: number;
  mistakeId: bigint;
  moveClocksMs: number[] | null;
  initialTimeSeconds: number | null;
  timeClass: string | null;
}

export function occurrencesSql(after: { gameId: bigint; ply: number }, limit: number, s: TimePressureScope = {}): Prisma.Sql {
  return Prisma.sql`
    SELECT o."gameId", o.ply::int AS ply, o."mistakeId", g."moveClocksMs", g."initialTimeSeconds", g."timeClass"::text AS "timeClass"
      FROM mistake_occurrences o
      JOIN mistakes m ON m.id = o."mistakeId"
      JOIN games g ON g.id = o."gameId"
     WHERE ${untagged(s)} AND (o."gameId", o.ply) > (${after.gameId.toString()}::bigint, ${after.ply}::int)
     ORDER BY o."gameId", o.ply
     LIMIT ${limit}`;
}

/** The pure step: the occurrence was played with under a minute on the member's clock. */
export function underAMinute(r: OccurrenceRow): boolean {
  return isTimePressure({ moveClocksMs: r.moveClocksMs ?? [], initialTimeSeconds: r.initialTimeSeconds, timeClass: r.timeClass }, r.ply);
}

export function tagSql(mistakeIds: readonly bigint[]): Prisma.Sql {
  return Prisma.sql`
    UPDATE mistakes SET themes = array_append(themes, ${TIME_PRESSURE_THEME})
     WHERE id = ANY(${mistakeIds.map((id) => id.toString())}::bigint[]) AND NOT (${TIME_PRESSURE_THEME} = ANY(themes))`;
}

export interface TimePressureOutcome {
  batches: number;
  /** Occurrences looked at. */
  seen: number;
  /** Occurrences under a minute. */
  underMinute: number;
  /** Mistakes tagged (rows changed). */
  tagged: number;
}

/**
 * Every keyset batch until the predicate is exhausted. With `apply: false` nothing is written and `tagged` counts the
 * distinct mistakes that would be tagged.
 */
export async function runTimePressure(
  db: BackfillDb,
  opts: TimePressureScope & { apply: boolean; limit?: number; log?: (line: string) => void },
): Promise<TimePressureOutcome> {
  const limit = opts.limit ?? BATCH_SIZE;
  const out: TimePressureOutcome = { batches: 0, seen: 0, underMinute: 0, tagged: 0 };
  const wouldTag = new Set<string>();
  let after = { gameId: 0n, ply: -1 };
  for (;;) {
    const rows = await db.$queryRaw<OccurrenceRow[]>(occurrencesSql(after, limit, opts));
    if (rows.length === 0) break;
    const hits = rows.filter(underAMinute);
    const ids = [...new Set(hits.map((r) => r.mistakeId.toString()))].map((id) => BigInt(id));
    let changed = 0;
    if (opts.apply && ids.length > 0) changed = await db.$executeRaw(tagSql(ids));
    if (!opts.apply) for (const id of ids) wouldTag.add(id.toString());
    out.batches++;
    out.seen += rows.length;
    out.underMinute += hits.length;
    out.tagged += changed;
    opts.log?.(`  batch ${out.batches}: ${rows.length} occurrence(s), ${hits.length} under a minute, ${opts.apply ? `${changed} mistake(s) tagged` : `${ids.length} to tag`}`);
    const last = rows[rows.length - 1] as OccurrenceRow;
    after = { gameId: BigInt(last.gameId), ply: last.ply };
    if (rows.length < limit) break;
  }
  if (!opts.apply) out.tagged = wouldTag.size;
  return out;
}

async function main(): Promise<void> {
  const { rest, member } = splitMemberArg(process.argv.slice(2));
  const cli = parseBackfillArgs(rest);
  const { db } = await openBackfillDb((l) => console.log(l));
  try {
    const userIds = await memberIdsOf(db, member);
    const before = await countOccurrences(db, { userIds });
    console.log(`mode     ${cli.apply ? "APPLY" : "dry run (pass --apply to write)"}`);
    console.log(`found    ${before.occurrences} occurrence(s) of ${before.mistakes} mistake(s) without ${TIME_PRESSURE_THEME}`);
    const r = await runTimePressure(db, { userIds, apply: cli.apply, log: (l) => console.log(l) });
    if (!cli.apply) {
      console.log(`\ndry run: ${r.underMinute} occurrence(s) under a minute; ${r.tagged} mistake(s) would be tagged. No writes.`);
      return;
    }
    await recordP6Backfill(db, "mistake_time_pressure", { occurrences: r.seen, underMinute: r.underMinute, tagged: r.tagged, batches: r.batches });
    console.log(`\napplied: ${r.tagged} mistake(s) tagged ${TIME_PRESSURE_THEME} over ${r.batches} batch(es).`);
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("backfill/backfill-mistake-timepressure", err));
