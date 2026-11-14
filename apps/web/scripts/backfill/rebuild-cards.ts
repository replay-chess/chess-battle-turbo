/**
 * Card repair tool (phase-05 plan 3.3 `rebuild-cards.ts`, 8.1 step 8; D-9): every key-moment ply of an extracted game
 * side (`bankVersion ≥ 1`) whose mistake is not hidden and that the member did not opt out of
 * (`PlayerReview.progress.bankOptOut`) must have a BANK card. The extraction creates them in the same batch as the
 * mistakes; this tool re-creates any that are missing (a bug, a manual delete, a restored backup) exactly as the worker
 * would: NEW, due at the member's next local release (`nextRelease`, the member's zone and releaseHour), item key
 * `m_<sqid(epdHash)>`, kind MISTAKE for scored puzzles else REVIEW_POSITION, and `theme_mastery."bankCount"` + 1 per card.
 *
 *   cd apps/web
 *   npx tsx scripts/backfill/rebuild-cards.ts            # dry run: the missing cards per member
 *   npx tsx scripts/backfill/rebuild-cards.ts --apply    # creates them, batches of 500 members
 *
 * Idempotent: ON CONFLICT ("userId","itemKey") DO NOTHING, and the selection only finds mistakes without a card, so a
 * second --apply creates nothing. Removed cards of hidden mistakes stay removed. Rules: ./p04-common.ts.
 */
import { Prisma } from "@repo/db";
import { mistakeItemKey } from "@repo/chess-training/items";
import { nextRelease } from "@repo/chess-training/release";
import { DEFAULT_RELEASE_HOUR, DEFAULT_TIME_ZONE } from "@repo/chess-training/constants";
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

export interface RebuildScope {
  userIds?: readonly bigint[] | null;
}

export interface MissingCard {
  userId: bigint;
  mistakeId: bigint;
  epdHash: bigint;
  isPuzzle: boolean;
  timeZone: string | null;
  releaseHour: number | null;
}

export interface CardInsert {
  userId: string;
  mistakeId: string;
  kind: "MISTAKE" | "REVIEW_POSITION";
  itemKey: string;
  due: string;
}

const scope = (s: RebuildScope) =>
  s.userIds && s.userIds.length > 0 ? Prisma.sql`AND gp."userId" = ANY(${s.userIds.map((u) => u.toString())}::bigint[])` : Prisma.empty;

/** One batch of members (by id, with an extracted game side) and their missing cards. */
export function missingCardsSql(after: bigint, limit: number, s: RebuildScope = {}): Prisma.Sql {
  return Prisma.sql`
    WITH members AS (
      SELECT DISTINCT gp."userId" FROM game_players gp
       WHERE gp."bankVersion" >= 1 AND gp."userId" > ${after.toString()}::bigint ${scope(s)}
       ORDER BY gp."userId" LIMIT ${limit}
    ), missing AS (
      SELECT DISTINCT mk.id AS "mistakeId", mk."userId", mk."epdHash", mk."isPuzzle"
        FROM members m
        JOIN game_players gp ON gp."userId" = m."userId" AND gp."bankVersion" >= 1
        JOIN player_reviews pr ON pr."gameId" = gp."gameId" AND pr.color = gp.color
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pr.content -> 'moments', '[]'::jsonb)) mo
        JOIN mistake_occurrences o ON o."gameId" = gp."gameId" AND o.ply = (mo ->> 'ply')::int
        JOIN mistakes mk ON mk.id = o."mistakeId" AND mk."userId" = gp."userId" AND mk."hiddenAt" IS NULL
       WHERE NOT (COALESCE(pr.progress -> 'bankOptOut', '[]'::jsonb) @> to_jsonb((mo ->> 'ply')::int))
         AND NOT EXISTS (SELECT 1 FROM training_cards c WHERE c."mistakeId" = mk.id)
    )
    SELECT (SELECT count(*)::int FROM members) AS size, (SELECT max("userId") FROM members) AS last,
           COALESCE((SELECT json_agg(json_build_object('userId', x."userId"::text, 'mistakeId', x."mistakeId"::text,
                                                       'epdHash', x."epdHash"::text, 'isPuzzle', x."isPuzzle",
                                                       'timeZone', u."timeZone", 'releaseHour', tp."releaseHour")
                                     ORDER BY x."mistakeId")
                       FROM missing x JOIN users u ON u.id = x."userId"
                       LEFT JOIN training_profiles tp ON tp."userId" = x."userId"), '[]'::json) AS missing`;
}

/** The card the worker would have created (pure). */
export function cardFor(m: MissingCard, now: Date): CardInsert {
  const due = nextRelease(now, m.timeZone ?? DEFAULT_TIME_ZONE, m.releaseHour ?? DEFAULT_RELEASE_HOUR);
  return {
    userId: m.userId.toString(),
    mistakeId: m.mistakeId.toString(),
    kind: m.isPuzzle ? "MISTAKE" : "REVIEW_POSITION",
    itemKey: mistakeItemKey(m.epdHash),
    due: due.toISOString().replace("T", " ").replace("Z", ""),
  };
}

/** The inserts and the bankCount increments, in one statement (ON CONFLICT DO NOTHING; increments for inserted only). */
export function insertCardsSql(cards: readonly CardInsert[]): Prisma.Sql {
  return Prisma.sql`
    WITH ins AS (
      INSERT INTO training_cards ("userId", deck, kind, "itemKey", "mistakeId", theme, phase, due, state, "createdAt",
                                  "updatedAt")
      SELECT m."userId", 'BANK', x.kind::"TrainingItemKind", x."itemKey", m.id, m."primaryTheme", m.phase, x.due, 'NEW',
             (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
        FROM jsonb_to_recordset(${JSON.stringify(cards)}::jsonb)
             AS x("userId" bigint, "mistakeId" bigint, kind text, "itemKey" text, due timestamp(3))
        JOIN mistakes m ON m.id = x."mistakeId" AND m."userId" = x."userId" AND m."hiddenAt" IS NULL
      ON CONFLICT ("userId", "itemKey") DO NOTHING
      RETURNING "userId", theme
    ), tm AS (
      INSERT INTO theme_mastery ("userId", theme, "bankCount")
      SELECT "userId", theme, count(*)::smallint FROM ins GROUP BY 1, 2
      ON CONFLICT ("userId", theme) DO UPDATE SET "bankCount" = theme_mastery."bankCount" + EXCLUDED."bankCount"
      RETURNING 1
    )
    SELECT (SELECT count(*)::int FROM ins) AS created`;
}

export async function runRebuild(
  db: BackfillDb,
  opts: RebuildScope & { apply: boolean; now: Date; limit?: number; log?: (line: string) => void },
): Promise<{ members: number; missing: number; created: number; batches: number }> {
  let members = 0;
  let missing = 0;
  let created = 0;
  const batches = await eachBatch(async (cursor, limit) => {
    const [r] = await db.$queryRaw<{ size: number; last: bigint | null; missing: Record<string, unknown>[] }[]>(
      missingCardsSql(cursor, limit, opts),
    );
    if (!r || r.size === 0 || r.last === null) return { last: null, size: 0 };
    members += r.size;
    const rows: MissingCard[] = r.missing.map((x) => ({
      userId: BigInt(String(x.userId)),
      mistakeId: BigInt(String(x.mistakeId)),
      epdHash: BigInt(String(x.epdHash)),
      isPuzzle: x.isPuzzle === true,
      timeZone: typeof x.timeZone === "string" ? x.timeZone : null,
      releaseHour: typeof x.releaseHour === "number" ? x.releaseHour : null,
    }));
    missing += rows.length;
    if (opts.apply && rows.length > 0) {
      const [c] = await db.$queryRaw<{ created: number }[]>(insertCardsSql(rows.map((m) => cardFor(m, opts.now))));
      created += c?.created ?? 0;
    }
    opts.log?.(`  batch: ${r.size} member(s), ${rows.length} missing card(s)${opts.apply ? " created" : ""}`);
    return { last: BigInt(r.last), size: r.size };
  }, opts.limit ?? BATCH_SIZE);
  return { members, missing, created, batches };
}

async function main(): Promise<void> {
  const cli = parseBackfillArgs(process.argv.slice(2));
  const { db } = await openBackfillDb((l) => console.log(l));
  try {
    console.log(`mode     ${cli.apply ? "APPLY" : "dry run (pass --apply to write)"}`);
    const r = await runRebuild(db, { apply: cli.apply, now: new Date(), log: (l) => console.log(l) });
    console.log(`\n${cli.apply ? "applied" : "dry run"}: ${r.members} member(s), ${r.missing} missing card(s)${cli.apply ? `, ${r.created} created` : ""}.`);
    if (cli.apply) await recordP5Backfill(db, "bank_cards_rebuild", { members: r.members, missing: r.missing, created: r.created });
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("backfill/rebuild-cards", err));
