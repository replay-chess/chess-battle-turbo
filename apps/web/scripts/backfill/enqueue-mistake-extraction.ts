/**
 * B-M5-1 Mistake Bank backfill (phase-05 plan 6.7, 7.6): every analysed game side extracted with an older rules
 * version (`game_players."bankVersion" < EXTRACT_VERSION`) gets one EXTRACT_MISTAKES job, so the bank holds the
 * mistakes of games analysed before P5 (or before an EXTRACT_VERSION bump).
 *
 *   cd apps/web
 *   npx tsx scripts/backfill/enqueue-mistake-extraction.ts                    # dry run: candidates, members, a sample
 *   npx tsx scripts/backfill/enqueue-mistake-extraction.ts --apply            # inserts the jobs in batches of 500
 *   npx tsx scripts/backfill/enqueue-mistake-extraction.ts --verify           # after the drain: what is left + a spot check
 *   … --member <email>                                                        # only that member's games
 *
 * Statement per keyset batch over `(gameId, userId)`: INSERT INTO jobs (kind EXTRACT_MISTAKES, dedupeKey
 * `extract:<gameId>:<userId>:v<EXTRACT_VERSION>` (= extractMistakesDedupeKey), priority JOB_PRIORITY.BACKLOG, fairSeq =
 * row_number() OVER (PARTITION BY userId ORDER BY endedAt DESC) inside the batch, payload
 * `ExtractMistakesPayloadV1 {v:1, gameId, userId}` with the ids as decimal strings, maxAttempts 3) … ON CONFLICT
 * ("dedupeKey") DO NOTHING. Predicate: `games."analysisStatus" = 'DONE' AND gp."bankVersion" < EXTRACT_VERSION`. A second
 * apply inserts nothing (the dedupe key); the worker sets bankVersion, so after the drain the predicate is empty.
 * Then ONE kick (./p05-common.ts).
 *
 * Rules: ./p04-common.ts (host guard, tripwire, dry run by default, one audit row per apply). Release rule (plan 6.6):
 * run --apply only once the worker build that HANDLES EXTRACT_MISTAKES is deployed (release N+1); release N only knows
 * the enum value. Runs on the Neon dev branch in stage B (owner action), never in stage A.
 */
import { Prisma } from "@repo/db";
import {
  EXTRACT_VERSION,
  extractMistakesDedupeKey,
  JOB_MAX_ATTEMPTS,
  JOB_PRIORITY,
} from "@repo/contracts/internal/jobs";
import {
  BATCH_SIZE,
  isEntryPoint,
  openBackfillDb,
  parseBackfillArgs,
  reportFailure,
  SeedGuardError,
  type BackfillDb,
} from "./p04-common";
import { kickExtraction, recordP5Backfill } from "./p05-common";

export interface ExtractionScope {
  /** Only these members (the CLI's --member; tests). */
  userIds?: readonly bigint[] | null;
  version?: number;
}

const scopeSql = (s: ExtractionScope) =>
  s.userIds && s.userIds.length > 0
    ? Prisma.sql`AND gp."userId" = ANY(${s.userIds.map((u) => u.toString())}::bigint[])`
    : Prisma.empty;

/** The predicate of plan 6.7 (and the verification's "0 left"). */
export function eligibleSql(s: ExtractionScope): Prisma.Sql {
  return Prisma.sql`g."analysisStatus" = 'DONE' AND gp."bankVersion" < ${s.version ?? EXTRACT_VERSION} ${scopeSql(s)}`;
}

/** Dry run: how many game sides, how many members. */
export async function countCandidates(db: BackfillDb, s: ExtractionScope = {}): Promise<{ sides: number; members: number }> {
  const rows = await db.$queryRaw<{ sides: number; members: number }[]>(Prisma.sql`
    SELECT count(*)::int AS sides, count(DISTINCT gp."userId")::int AS members
      FROM game_players gp JOIN games g ON g.id = gp."gameId"
     WHERE ${eligibleSql(s)}`);
  return rows[0] ?? { sides: 0, members: 0 };
}

/** One keyset batch: the candidates after `(lastGame, lastUser)` and their jobs, in one statement. */
export function enqueueBatchSql(after: { gameId: bigint; userId: bigint }, limit: number, s: ExtractionScope = {}): Prisma.Sql {
  const version = s.version ?? EXTRACT_VERSION;
  return Prisma.sql`
    WITH batch AS (
      SELECT gp."gameId", gp."userId", gp."endedAt"
        FROM game_players gp JOIN games g ON g.id = gp."gameId"
       WHERE ${eligibleSql(s)} AND (gp."gameId", gp."userId") > (${after.gameId.toString()}::bigint, ${after.userId.toString()}::bigint)
       ORDER BY gp."gameId", gp."userId"
       LIMIT ${limit}
    ), ins AS (
      INSERT INTO jobs (kind, "dedupeKey", priority, "fairSeq", payload, "userId", "gameId", "runAt", "maxAttempts", "createdAt")
      SELECT 'EXTRACT_MISTAKES', 'extract:' || b."gameId" || ':' || b."userId" || ':v' || ${version}::int,
             ${JOB_PRIORITY.BACKLOG}::smallint,
             row_number() OVER (PARTITION BY b."userId" ORDER BY b."endedAt" DESC NULLS LAST, b."gameId" DESC)::int,
             jsonb_build_object('v', 1, 'gameId', b."gameId"::text, 'userId', b."userId"::text),
             b."userId", b."gameId", (now() AT TIME ZONE 'UTC'), ${JOB_MAX_ATTEMPTS.EXTRACT_MISTAKES}::smallint,
             (now() AT TIME ZONE 'UTC')
        FROM batch b
      ON CONFLICT ("dedupeKey") DO NOTHING
      RETURNING 1
    )
    SELECT (SELECT count(*)::int FROM batch) AS size, (SELECT count(*)::int FROM ins) AS inserted,
           (SELECT "gameId" FROM batch ORDER BY "gameId" DESC, "userId" DESC LIMIT 1) AS "lastGameId",
           (SELECT "userId" FROM batch ORDER BY "gameId" DESC, "userId" DESC LIMIT 1) AS "lastUserId"`;
}

export interface EnqueueOutcome {
  batches: number;
  seen: number;
  inserted: number;
}

/** --apply: every keyset batch until the predicate is exhausted. */
export async function runEnqueueExtraction(
  db: BackfillDb,
  opts: ExtractionScope & { limit?: number; log?: (line: string) => void } = {},
): Promise<EnqueueOutcome> {
  const limit = opts.limit ?? BATCH_SIZE;
  let after = { gameId: 0n, userId: 0n };
  const out: EnqueueOutcome = { batches: 0, seen: 0, inserted: 0 };
  for (;;) {
    const [r] = await db.$queryRaw<{ size: number; inserted: number; lastGameId: bigint | null; lastUserId: bigint | null }[]>(
      enqueueBatchSql(after, limit, opts),
    );
    if (!r || r.size === 0 || r.lastGameId === null || r.lastUserId === null) break;
    out.batches++;
    out.seen += r.size;
    out.inserted += r.inserted;
    opts.log?.(`  batch ${out.batches}: ${r.size} game side(s), ${r.inserted} job(s) inserted`);
    after = { gameId: BigInt(r.lastGameId), userId: BigInt(r.lastUserId) };
    if (r.size < limit) break;
  }
  return out;
}

export interface SpotCheck {
  gameId: string;
  userId: string;
  moments: number;
  occurrences: number;
  cardsExpected: number;
  cards: number;
}

/**
 * --verify: up to `n` extracted game sides (legacy games with unknown colours extract nothing and are left out); for each, its key-moment error plies (PlayerReview.content.moments) must
 * all have an occurrence, and the ones not in progress.bankOptOut whose mistake is not hidden a BANK card.
 */
export async function spotCheck(db: BackfillDb, n = 10, s: ExtractionScope = {}): Promise<SpotCheck[]> {
  return db.$queryRaw<SpotCheck[]>(Prisma.sql`
    WITH sides AS (
      SELECT gp."gameId", gp."userId", gp.color FROM game_players gp JOIN games g ON g.id = gp."gameId"
       WHERE g."analysisStatus" = 'DONE' AND gp."bankVersion" >= ${s.version ?? EXTRACT_VERSION} ${scopeSql(s)}
         AND NOT COALESCE(g.meta ? 'colorUnknown', false)
       ORDER BY gp."gameId" DESC LIMIT ${n}
    ), m AS (
      SELECT sd."gameId", sd."userId", (mo->>'ply')::int AS ply,
             COALESCE(pr.progress->'bankOptOut', '[]'::jsonb) @> to_jsonb((mo->>'ply')::int) AS "optedOut"
        FROM sides sd JOIN player_reviews pr ON pr."gameId" = sd."gameId" AND pr.color = sd.color
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pr.content->'moments', '[]'::jsonb)) mo
    )
    SELECT sd."gameId"::text AS "gameId", sd."userId"::text AS "userId",
           (SELECT count(*)::int FROM m WHERE m."gameId" = sd."gameId" AND m."userId" = sd."userId") AS moments,
           (SELECT count(*)::int FROM m JOIN mistake_occurrences o ON o."gameId" = m."gameId" AND o.ply = m.ply
             WHERE m."gameId" = sd."gameId" AND m."userId" = sd."userId") AS occurrences,
           (SELECT count(*)::int FROM m JOIN mistake_occurrences o ON o."gameId" = m."gameId" AND o.ply = m.ply
              JOIN mistakes mk ON mk.id = o."mistakeId" AND mk."hiddenAt" IS NULL
             WHERE m."gameId" = sd."gameId" AND m."userId" = sd."userId" AND NOT m."optedOut") AS "cardsExpected",
           (SELECT count(*)::int FROM m JOIN mistake_occurrences o ON o."gameId" = m."gameId" AND o.ply = m.ply
              JOIN mistakes mk ON mk.id = o."mistakeId" AND mk."hiddenAt" IS NULL
              JOIN training_cards c ON c."mistakeId" = mk.id AND c.deck = 'BANK'
             WHERE m."gameId" = sd."gameId" AND m."userId" = sd."userId" AND NOT m."optedOut") AS cards
      FROM sides sd`);
}

/** A spot check passes when every moment has its occurrence and every expected card exists. */
export function spotCheckPasses(rows: readonly SpotCheck[]): boolean {
  return rows.every((r) => r.occurrences === r.moments && r.cards === r.cardsExpected);
}

async function memberIdOf(db: BackfillDb, email: string | undefined): Promise<bigint[] | null> {
  if (!email) return null;
  const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`);
  if (!rows[0]) throw new SeedGuardError("no user with that email");
  return [rows[0].id];
}

/** `--member <email>` sits outside parseBackfillArgs' boolean flags. */
export function splitMemberArg(argv: readonly string[]): { rest: string[]; member: string | undefined } {
  const i = argv.indexOf("--member");
  if (i < 0) return { rest: [...argv], member: undefined };
  const member = argv[i + 1];
  if (!member || member.startsWith("--")) throw new SeedGuardError("--member needs an email");
  return { rest: [...argv.slice(0, i), ...argv.slice(i + 2)], member };
}

async function main(): Promise<void> {
  const { rest, member } = splitMemberArg(process.argv.slice(2));
  const cli = parseBackfillArgs(rest, ["--verify"]);
  const opened = await openBackfillDb((l) => console.log(l));
  const { db } = opened;
  try {
    const userIds = await memberIdOf(db, member);
    const scope: ExtractionScope = { userIds };
    const before = await countCandidates(db, scope);
    console.log(`mode     ${cli.flags.has("--verify") ? "verify" : cli.apply ? "APPLY" : "dry run (pass --apply to write)"}`);
    console.log(`found    ${before.sides} analysed game side(s) with bankVersion < ${EXTRACT_VERSION}, ${before.members} member(s)`);
    console.log(`job key  e.g. ${extractMistakesDedupeKey(1, 2)} · priority BACKLOG (${JOB_PRIORITY.BACKLOG})`);
    if (cli.flags.has("--verify")) {
      const rows = await spotCheck(db, 10, scope);
      for (const r of rows) {
        console.log(`  game ${r.gameId} user ${r.userId}: moments ${r.moments}, occurrences ${r.occurrences}, cards ${r.cards}/${r.cardsExpected}`);
      }
      const ok = before.sides === 0 && spotCheckPasses(rows);
      console.log(ok ? "\nverified: nothing left, spot check passed." : "\nNOT verified: see the counts above.");
      if (!ok) process.exitCode = 1;
      return;
    }
    if (!cli.apply) {
      console.log("\ndry run: no writes.");
      return;
    }
    const r = await runEnqueueExtraction(db, { userIds, log: (l) => console.log(l) });
    await recordP5Backfill(db, "mistake_extraction", { sides: r.seen, inserted: r.inserted, batches: r.batches, version: EXTRACT_VERSION });
    console.log(`\napplied: ${r.inserted} EXTRACT_MISTAKES job(s) inserted over ${r.batches} batch(es).`);
    if (r.inserted > 0) console.log(await kickExtraction());
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("backfill/enqueue-mistake-extraction", err));
