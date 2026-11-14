/**
 * B-M5-2 repair tool (phase-05 plan 6.7): `theme_mastery."bankCount"` = the member's live BANK cards with that primary
 * theme. The worker (J1 / EXTRACT_MISTAKES) and the web (W6 remove, A6 toggle) keep it incrementally; this recount
 * restores it if a bug or a manual fix ever lets it drift.
 *
 *   cd apps/web
 *   npx tsx scripts/backfill/recount-bank-themes.ts            # dry run: rows that would change
 *   npx tsx scripts/backfill/recount-bank-themes.ts --apply    # fixes them in batches of 500 members
 *
 * Per keyset batch of members (users that have a BANK card or a theme_mastery row, `userId > $cursor`), one statement:
 * upsert the true count of every (user, theme) with cards, and zero the rows of themes without a card. Rows already
 * right are not written (`IS DISTINCT FROM`), so a second --apply changes nothing. Rules: ./p04-common.ts.
 */
import { Prisma } from "@repo/db";
import {
  BATCH_SIZE,
  eachBatch,
  isEntryPoint,
  openBackfillDb,
  parseBackfillArgs,
  reportFailure,
  type BackfillDb,
} from "./p04-common";
import { recordP5Backfill } from "./p05-common";

export interface RecountScope {
  /** Only these members (tests). */
  userIds?: readonly bigint[] | null;
}

const scope = (s: RecountScope, col: Prisma.Sql) =>
  s.userIds && s.userIds.length > 0 ? Prisma.sql`AND ${col} = ANY(${s.userIds.map((u) => u.toString())}::bigint[])` : Prisma.empty;

/** The members of one batch: everyone with a BANK card or a mastery row, by id. */
function membersSql(after: bigint, limit: number, s: RecountScope): Prisma.Sql {
  return Prisma.sql`
    SELECT "userId" FROM (
      SELECT "userId" FROM training_cards WHERE deck = 'BANK' AND "userId" > ${after.toString()}::bigint ${scope(s, Prisma.sql`"userId"`)}
      UNION
      SELECT "userId" FROM theme_mastery WHERE "userId" > ${after.toString()}::bigint ${scope(s, Prisma.sql`"userId"`)}
    ) u ORDER BY "userId" LIMIT ${limit}`;
}

/** Dry run of one batch: the (user, theme) rows whose stored bankCount differs from the cards. */
export function driftSql(after: bigint, limit: number, s: RecountScope = {}): Prisma.Sql {
  return Prisma.sql`
    WITH members AS (${membersSql(after, limit, s)}),
    truth AS (
      SELECT c."userId", c.theme, count(*)::int AS n FROM training_cards c JOIN members m ON m."userId" = c."userId"
       WHERE c.deck = 'BANK' GROUP BY 1, 2
    )
    SELECT (SELECT count(*)::int FROM members) AS size, (SELECT max("userId") FROM members) AS last,
           (SELECT count(*)::int FROM truth t LEFT JOIN theme_mastery tm ON tm."userId" = t."userId" AND tm.theme = t.theme
             WHERE tm."bankCount" IS DISTINCT FROM t.n)
         + (SELECT count(*)::int FROM theme_mastery tm JOIN members m ON m."userId" = tm."userId"
             WHERE tm."bankCount" <> 0 AND NOT EXISTS (SELECT 1 FROM truth t WHERE t."userId" = tm."userId" AND t.theme = tm.theme))
           AS drift`;
}

/** --apply of one batch: the upsert of the true counts and the zeroing, in one statement. */
export function recountSql(after: bigint, limit: number, s: RecountScope = {}): Prisma.Sql {
  return Prisma.sql`
    WITH members AS (${membersSql(after, limit, s)}),
    truth AS (
      SELECT c."userId", c.theme, count(*)::smallint AS n FROM training_cards c JOIN members m ON m."userId" = c."userId"
       WHERE c.deck = 'BANK' GROUP BY 1, 2
    ), up AS (
      INSERT INTO theme_mastery ("userId", theme, "bankCount")
      SELECT "userId", theme, n FROM truth
      ON CONFLICT ("userId", theme) DO UPDATE SET "bankCount" = EXCLUDED."bankCount"
       WHERE theme_mastery."bankCount" IS DISTINCT FROM EXCLUDED."bankCount"
      RETURNING 1
    ), zero AS (
      UPDATE theme_mastery tm SET "bankCount" = 0 FROM members m
       WHERE tm."userId" = m."userId" AND tm."bankCount" <> 0
         AND NOT EXISTS (SELECT 1 FROM truth t WHERE t."userId" = tm."userId" AND t.theme = tm.theme)
      RETURNING 1
    )
    SELECT (SELECT count(*)::int FROM members) AS size, (SELECT max("userId") FROM members) AS last,
           (SELECT count(*)::int FROM up) + (SELECT count(*)::int FROM zero) AS drift`;
}

export async function runRecount(
  db: BackfillDb,
  opts: RecountScope & { apply: boolean; limit?: number; log?: (line: string) => void },
): Promise<{ members: number; fixed: number; batches: number }> {
  let members = 0;
  let fixed = 0;
  const batches = await eachBatch(async (cursor, limit) => {
    const [r] = await db.$queryRaw<{ size: number; last: bigint | null; drift: number }[]>(
      opts.apply ? recountSql(cursor, limit, opts) : driftSql(cursor, limit, opts),
    );
    if (!r || r.size === 0 || r.last === null) return { last: null, size: 0 };
    members += r.size;
    fixed += r.drift;
    opts.log?.(`  batch: ${r.size} member(s), ${r.drift} row(s) ${opts.apply ? "fixed" : "would change"}`);
    return { last: BigInt(r.last), size: r.size };
  }, opts.limit ?? BATCH_SIZE);
  return { members, fixed, batches };
}

async function main(): Promise<void> {
  const cli = parseBackfillArgs(process.argv.slice(2));
  const { db } = await openBackfillDb((l) => console.log(l));
  try {
    console.log(`mode     ${cli.apply ? "APPLY" : "dry run (pass --apply to write)"}`);
    const r = await runRecount(db, { apply: cli.apply, log: (l) => console.log(l) });
    console.log(`\n${cli.apply ? "applied" : "dry run"}: ${r.members} member(s) checked, ${r.fixed} theme row(s) ${cli.apply ? "fixed" : "drifted"}.`);
    if (cli.apply) await recordP5Backfill(db, "bank_theme_recount", { members: r.members, fixed: r.fixed, batches: r.batches });
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("backfill/recount-bank-themes", err));
