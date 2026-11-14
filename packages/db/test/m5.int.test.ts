/**
 * m5a / M5 landed as written (phase-05 plan 6.1-6.6): on a real Postgres after `prisma migrate deploy`, the schema
 * behaves the way the plan's statements need it to. Skipped unless TEST_DATABASE_URL is set (a local Docker Postgres or
 * the CI service; never Neon).
 *
 *   - the enums carry exactly the plan's values, JobKind ends with EXTRACT_MISTAKES (m5a);
 *   - game_players."bankVersion" defaults to 0;
 *   - natural keys: one mistake per (user, epdHash) with the J1 upsert's ON CONFLICT, one occurrence per (game, ply),
 *     one card per (user, itemKey) and per mistake, one attempt per clientAttemptId;
 *   - cascades: game → occurrences, mistake → occurrences + card, user → every P5 private row; a reporter's deletion
 *     keeps the report (SET NULL); history columns (cardId, sessionId) have no FK;
 *   - the raw SQL: the partial index serves the "seen in 90 days" query and holds no bank attempt, fillfactor 80 and
 *     lz4 are set, and the precondition guard refuses a database without what P5 reads;
 *   - with TEST_APP_DATABASE_URL (replay_app.p5.sql applied), the web role can write what the routes write.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Prisma, type PrismaClient } from "#generated";
import { createPrismaClient } from "../src/client";
import { TEST_URL, assertLocalTestUrl, makeUser, run } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.TEST_APP_DATABASE_URL;
const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
let seq = 0;

async function game(db: PrismaClient, userId: bigint): Promise<bigint> {
  seq++;
  const ref = `cg5${run}${String(seq).padStart(5, "0")}`.slice(0, 25);
  const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
    INSERT INTO games ("referenceId", "creatorId", status, "startingFen", "initialTimeSeconds", "incrementSeconds",
                       "creatorTimeRemaining", "opponentTimeRemaining", "expiresAt", "updatedAt", "whitePlayerId", "plyCount", "completedAt")
    VALUES (${ref}, ${userId}, 'COMPLETED', ${INITIAL_FEN}, 600, 0, 0, 0, now(), now(), ${userId}, 40, now())
    RETURNING id`);
  const id = rows[0]!.id;
  await db.$executeRaw(Prisma.sql`
    INSERT INTO game_players ("gameId", "userId", color, mode, "updatedAt", result, "endedAt")
    VALUES (${id}, ${userId}, 'w', 'BOT', now(), 'LOSS', now())`);
  return id;
}

/** The J1 statement shape (plan 7.6 step 1), reduced: insert or refresh the "last seen" fields. */
async function upsertMistake(db: PrismaClient, userId: bigint, epdHash: bigint, lastPlayedAt: string, opponent: string) {
  seq++;
  const ref = `cm5${run}${String(seq).padStart(5, "0")}`.slice(0, 25);
  const m = JSON.stringify([{ referenceId: ref, userId: String(userId), epdHash: String(epdHash), lastPlayedAt, lastOpponentName: opponent }]);
  await db.$executeRaw(Prisma.sql`
    INSERT INTO mistakes ("referenceId", "userId", "epdHash", color, fen, solution, "playedUci", judgement, source, "isPuzzle",
                          "primaryTheme", phase, "winBefore", "winAfterPlayed", "moveNumber", "lastPlayedAt", "lastOpponentName", "updatedAt")
    SELECT x."referenceId", x."userId", x."epdHash", 'w', ${INITIAL_FEN}, 'e2e4', 'd2d4', 'MISTAKE', 'OWN_ERROR', false,
           'fork', 'OPENING', 55, 30, 5, x."lastPlayedAt", x."lastOpponentName", now()
      FROM jsonb_to_recordset(${m}::jsonb) AS x("referenceId" text, "userId" bigint, "epdHash" bigint, "lastPlayedAt" timestamp, "lastOpponentName" text)
    ON CONFLICT ("userId", "epdHash") DO UPDATE SET "lastPlayedAt" = EXCLUDED."lastPlayedAt", "lastOpponentName" = EXCLUDED."lastOpponentName",
       "updatedAt" = EXCLUDED."updatedAt"
    WHERE EXCLUDED."lastPlayedAt" >= mistakes."lastPlayedAt"`);
  const rows = await db.$queryRaw<{ id: bigint; name: string }[]>(Prisma.sql`
    SELECT id, "lastOpponentName" AS name FROM mistakes WHERE "userId" = ${userId} AND "epdHash" = ${epdHash}`);
  return rows[0]!;
}

async function card(db: PrismaClient, userId: bigint, itemKey: string, mistakeId: bigint | null, deck = "BANK", puzzleId: string | null = null) {
  const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
    INSERT INTO training_cards ("userId", deck, kind, "itemKey", "mistakeId", "puzzleId", theme, due, "updatedAt")
    VALUES (${userId}, ${deck}::"TrainingDeck", ${deck === "BANK" ? "MISTAKE" : "LICHESS_PUZZLE"}::"TrainingItemKind", ${itemKey},
            ${mistakeId}, ${puzzleId}, 'fork', now(), now())
    RETURNING id`);
  return rows[0]!.id;
}

async function attempt(db: PrismaClient, userId: bigint, uuid: string, puzzleId: string | null) {
  await db.$executeRaw(Prisma.sql`
    INSERT INTO training_attempts ("clientAttemptId", "userId", deck, kind, "puzzleId", theme, solved, "firstTry", "timeMs", "reviewedAt", grade)
    VALUES (${uuid}::uuid, ${userId}, ${puzzleId ? "PUZZLE" : "BANK"}::"TrainingDeck",
            ${puzzleId ? "LICHESS_PUZZLE" : "MISTAKE"}::"TrainingItemKind", ${puzzleId}, 'fork', true, true, 1000, now(), 'GOOD')`);
}

/** The SQLSTATE of a failed statement (Prisma puts it in meta.code for raw queries). */
async function errorCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (error) {
    const e = error as { code?: string; meta?: { code?: string } };
    return e.meta?.code ?? e.code;
  }
}

/** A fresh attempt id (the tests write into a database that earlier runs may have used). */
const uuid = () => randomUUID();

describe("M5 schema (Postgres)", { skip: TEST_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;

  before(() => {
    assertLocalTestUrl(TEST_URL!);
    db = createPrismaClient({ datasourceUrl: TEST_URL });
  });
  after(async () => db.$disconnect());

  it("the M5 enums carry the plan's values; JobKind ends with EXTRACT_MISTAKES (m5a)", async () => {
    const rows = await db.$queryRaw<{ t: string; v: string[] }[]>(Prisma.sql`
      SELECT t.typname AS t, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS v FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typname IN ('MistakeSource','GamePhase','TrainingDeck','TrainingItemKind','CardState','FsrsGrade','SessionKind',
                           'SessionStatus','ReportTarget','ReportReason','ReportStatus','JobKind')
       GROUP BY t.typname`);
    const by = Object.fromEntries(rows.map((r) => [r.t, r.v]));
    assert.deepEqual(by.MistakeSource, ["OWN_ERROR", "MISSED_PUNISH"]);
    assert.deepEqual(by.GamePhase, ["OPENING", "MIDDLEGAME", "ENDGAME"]);
    assert.deepEqual(by.TrainingDeck, ["BANK", "PUZZLE", "OPENING"]);
    assert.deepEqual(by.TrainingItemKind, ["MISTAKE", "REVIEW_POSITION", "LICHESS_PUZZLE", "OPENING_LINE"]);
    assert.deepEqual(by.CardState, ["NEW", "LEARNING", "REVIEW", "RELEARNING"]);
    assert.deepEqual(by.FsrsGrade, ["AGAIN", "HARD", "GOOD", "EASY"]);
    assert.deepEqual(by.SessionKind, ["DAILY", "BANK", "PUZZLES", "WEAKNESS", "PRACTICE"]);
    assert.deepEqual(by.SessionStatus, ["ACTIVE", "COMPLETED", "ABANDONED"]);
    assert.deepEqual(by.ReportTarget, ["USER", "GAME", "MISTAKE", "PUZZLE", "LESSON", "POSITION", "COACH_MESSAGE"]);
    assert.equal(by.ReportReason!.length, 8);
    assert.deepEqual(by.ReportStatus, ["OPEN", "ACTIONED", "DISMISSED"]);
    assert.equal(by.JobKind!.at(-1), "EXTRACT_MISTAKES");
  });

  it("game_players.bankVersion defaults to 0 (smallint, not null); nothing was added to users", async () => {
    const u = await makeUser(db, "m5bv");
    const g = await game(db, u.id);
    const rows = await db.$queryRaw<{ v: number }[]>(Prisma.sql`SELECT "bankVersion" AS v FROM game_players WHERE "gameId" = ${g}`);
    assert.equal(rows[0]!.v, 0);
    const cols = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT count(*)::bigint AS n FROM information_schema.columns
       WHERE table_name = 'users' AND column_name IN ('bankVersion', 'puzzleRating', 'dayStartHour')`);
    assert.equal(cols[0]!.n, 0n);
  });

  it("mistakes: one per (user, epdHash); the J1 upsert refreshes only from a newer occurrence", async () => {
    const u = await makeUser(db, "m5mk");
    const first = await upsertMistake(db, u.id, -42n, "2026-11-10T10:00:00.000", "vera_b");
    const newer = await upsertMistake(db, u.id, -42n, "2026-11-12T10:00:00.000", "tal_fan_77");
    assert.equal(newer.id, first.id);
    assert.equal(newer.name, "tal_fan_77");
    const older = await upsertMistake(db, u.id, -42n, "2026-11-01T10:00:00.000", "old_game");
    assert.equal(older.name, "tal_fan_77", "an older re-analysis never overwrites a newer occurrence");
    const other = await makeUser(db, "m5mk2");
    const theirs = await upsertMistake(db, other.id, -42n, "2026-11-10T10:00:00.000", "x");
    assert.notEqual(theirs.id, first.id, "the same position is a different row per member");
  });

  it("occurrences: one per (game, ply); cascade from the game and from the mistake", async () => {
    const u = await makeUser(db, "m5oc");
    const g = await game(db, u.id);
    const m = await upsertMistake(db, u.id, 7n, "2026-11-12T10:00:00.000", "a");
    await db.$executeRaw(Prisma.sql`INSERT INTO mistake_occurrences ("gameId", ply, "mistakeId") VALUES (${g}, 18, ${m.id})`);
    const again = await db.$executeRaw(Prisma.sql`
      INSERT INTO mistake_occurrences ("gameId", ply, "mistakeId") VALUES (${g}, 18, ${m.id}) ON CONFLICT DO NOTHING`);
    assert.equal(again, 0, "a re-analysis inserts nothing twice");
    await db.$executeRaw(Prisma.sql`DELETE FROM games WHERE id = ${g}`);
    const left = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS n FROM mistake_occurrences WHERE "mistakeId" = ${m.id}`);
    assert.equal(left[0]!.n, 0n);
    const g2 = await game(db, u.id);
    await db.$executeRaw(Prisma.sql`INSERT INTO mistake_occurrences ("gameId", ply, "mistakeId") VALUES (${g2}, 20, ${m.id})`);
    const c = await card(db, u.id, `m_occ${seq}`, m.id);
    await db.$executeRaw(Prisma.sql`DELETE FROM mistakes WHERE id = ${m.id}`);
    const rest = await db.$queryRaw<{ o: bigint; c: bigint }[]>(Prisma.sql`
      SELECT (SELECT count(*) FROM mistake_occurrences WHERE "gameId" = ${g2})::bigint AS o,
             (SELECT count(*) FROM training_cards WHERE id = ${c})::bigint AS c`);
    assert.deepEqual(rest[0], { o: 0n, c: 0n });
  });

  it("cards: one per (user, itemKey) and per mistake; J1's ON CONFLICT DO NOTHING absorbs a repeat", async () => {
    const u = await makeUser(db, "m5cd");
    const m = await upsertMistake(db, u.id, 99n, "2026-11-12T10:00:00.000", "a");
    await card(db, u.id, "m_dup1", m.id);
    assert.equal(await errorCode(card(db, u.id, "m_dup1", null)), "23505");
    assert.equal(await errorCode(card(db, u.id, "m_dup2", m.id)), "23505", "one card per mistake");
    const absorbed = await db.$executeRaw(Prisma.sql`
      INSERT INTO training_cards ("userId", deck, kind, "itemKey", "mistakeId", theme, due, "updatedAt")
      VALUES (${u.id}, 'BANK', 'MISTAKE', 'm_dup1', ${m.id}, 'fork', now(), now()) ON CONFLICT ("userId", "itemKey") DO NOTHING`);
    assert.equal(absorbed, 0);
    const defaults = await db.$queryRaw<{ state: string; mastery: number; reps: number }[]>(Prisma.sql`
      SELECT state::text AS state, mastery, reps FROM training_cards WHERE "userId" = ${u.id} AND "itemKey" = 'm_dup1'`);
    assert.deepEqual(defaults[0], { state: "NEW", mastery: 0, reps: 0 });
  });

  it("attempts: clientAttemptId is a unique uuid; cardId/sessionId are plain history columns", async () => {
    const u = await makeUser(db, "m5at");
    const id = uuid();
    await attempt(db, u.id, id, null);
    assert.equal(await errorCode(attempt(db, u.id, id, null)), "23505");
    assert.equal(await errorCode(attempt(db, u.id, "not-a-uuid", null)), "22P02", "invalid uuid input");
    const fks = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT count(*)::bigint AS n FROM pg_constraint WHERE conrelid = 'training_attempts'::regclass AND contype = 'f'`);
    assert.equal(fks[0]!.n, 1n, "only the user FK");
  });

  it("deleting a user cascades every P5 private row; a report outlives its reporter (SET NULL)", async () => {
    const u = await makeUser(db, "m5del");
    const m = await upsertMistake(db, u.id, 5n, "2026-11-12T10:00:00.000", "a");
    await card(db, u.id, "m_del1", m.id);
    seq++;
    await attempt(db, u.id, uuid(), "00Q7c");
    await db.$executeRaw(Prisma.sql`
      INSERT INTO training_sessions ("referenceId", "userId", kind, source, "filterKey", size, items, day)
      VALUES (${`cs5${run}${seq}`.slice(0, 25)}, ${u.id}, 'BANK', 'hub', 'k', 3, '{"v":1,"items":[]}', '2026-11-12')`);
    await db.$executeRaw(Prisma.sql`INSERT INTO training_days ("userId", day, "updatedAt") VALUES (${u.id}, '2026-11-12', now())`);
    await db.$executeRaw(Prisma.sql`INSERT INTO theme_mastery ("userId", theme) VALUES (${u.id}, 'fork')`);
    await db.$executeRaw(Prisma.sql`INSERT INTO training_profiles ("userId", "updatedAt") VALUES (${u.id}, now())`);
    const rep = `cr5${run}${seq}`.slice(0, 25);
    await db.$executeRaw(Prisma.sql`
      INSERT INTO reports ("referenceId", "reporterId", "targetType", "targetRef", reason) VALUES (${rep}, ${u.id}, 'MISTAKE', 'cx', 'BETTER_MOVE')`);
    await db.$executeRaw(Prisma.sql`DELETE FROM user_stats WHERE "userId" = ${u.id}`);
    await db.$executeRaw(Prisma.sql`DELETE FROM users WHERE id = ${u.id}`);
    const left = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT ((SELECT count(*) FROM mistakes WHERE "userId" = ${u.id}) + (SELECT count(*) FROM training_cards WHERE "userId" = ${u.id})
            + (SELECT count(*) FROM training_attempts WHERE "userId" = ${u.id}) + (SELECT count(*) FROM training_sessions WHERE "userId" = ${u.id})
            + (SELECT count(*) FROM training_days WHERE "userId" = ${u.id}) + (SELECT count(*) FROM theme_mastery WHERE "userId" = ${u.id})
            + (SELECT count(*) FROM training_profiles WHERE "userId" = ${u.id}))::bigint AS n`);
    assert.equal(left[0]!.n, 0n);
    const report = await db.$queryRaw<{ r: bigint | null }[]>(Prisma.sql`SELECT "reporterId" AS r FROM reports WHERE "referenceId" = ${rep}`);
    assert.equal(report[0]!.r, null);
  });

  it("the profile and day defaults are the plan's (rating 1500/350/0.06, day starts 04:00, release 08:00, cap 10, 5 new)", async () => {
    const u = await makeUser(db, "m5pf");
    await db.$executeRaw(Prisma.sql`INSERT INTO training_profiles ("userId", "updatedAt") VALUES (${u.id}, now())`);
    const p = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT "puzzleRating" AS r, "puzzleRd" AS rd, "dayStartHour" AS ds, "releaseHour" AS rh, "bankDailyCap" AS cap, "newPerDay" AS np,
             "autoGrade" AS ag, "ratingSeeded" AS seeded FROM training_profiles WHERE "userId" = ${u.id}`);
    assert.deepEqual(p[0], { r: 1500, rd: 350, ds: 4, rh: 8, cap: 10, np: 5, ag: false, seeded: false });
  });

  it("raw SQL: the partial index serves the 90-day exclusion and holds no bank attempt; fillfactor 80; lz4", async () => {
    const u = await makeUser(db, "m5px");
    seq++;
    await attempt(db, u.id, uuid(), "0009B");
    await attempt(db, u.id, uuid(), null);
    const def = await db.$queryRaw<{ d: string }[]>(Prisma.sql`SELECT indexdef AS d FROM pg_indexes WHERE indexname = 'training_attempts_puzzle_idx'`);
    assert.match(def[0]!.d, /WHERE \("puzzleId" IS NOT NULL\)/);
    const plan = await db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SET LOCAL enable_seqscan = off`);
      return tx.$queryRaw<{ "QUERY PLAN": string }[]>(Prisma.sql`
        EXPLAIN SELECT DISTINCT "puzzleId" FROM training_attempts
         WHERE "userId" = ${u.id} AND "puzzleId" = ANY(${["0009B", "00aKx"]}::text[]) AND "reviewedAt" > now() - interval '90 days'`);
    });
    assert.match(plan.map((r) => r["QUERY PLAN"]).join("\n"), /training_attempts_puzzle_idx/);
    const opts = await db.$queryRaw<{ t: string; o: string[] | null }[]>(Prisma.sql`
      SELECT relname AS t, reloptions AS o FROM pg_class WHERE relname IN ('training_days', 'theme_mastery', 'training_profiles') ORDER BY 1`);
    for (const r of opts) assert.ok(r.o?.includes("fillfactor=80"), r.t);
    const comp = await db.$queryRaw<{ c: string }[]>(Prisma.sql`
      SELECT attcompression::text AS c FROM pg_attribute
       WHERE (attrelid = 'training_sessions'::regclass AND attname = 'items') OR (attrelid = 'training_days'::regclass AND attname = 'plan')`);
    assert.deepEqual(comp.map((r) => r.c), ["l", "l"]);
  });

  it("the due index serves the bank's due query (no Seq Scan; at most an incremental sort on the id tie-break)", async () => {
    const u = await makeUser(db, "m5due");
    const plan = await db.$transaction(async (tx) => {
      // As the hot-query gates do: a tiny CI table would otherwise make any plan cheapest.
      await tx.$executeRaw(Prisma.sql`SET LOCAL enable_seqscan = off`);
      await tx.$executeRaw(Prisma.sql`SET LOCAL enable_sort = off`);
      return tx.$queryRaw<{ "QUERY PLAN": string }[]>(Prisma.sql`
        EXPLAIN SELECT id FROM training_cards WHERE "userId" = ${u.id} AND deck = 'BANK' AND due <= now() ORDER BY due, id LIMIT 50`);
    });
    const text = plan.map((r) => r["QUERY PLAN"]).join("\n");
    assert.match(text, /training_cards_userId_deck_due_idx/);
    assert.doesNotMatch(text, /Seq Scan/);
    assert.doesNotMatch(text, /->\s+Sort\b/, "a full sort would mean the index does not order by due");
  });

  it("the precondition guard refuses a database without what P5 reads (proved inside a rolled-back transaction)", async () => {
    const sql = readFileSync(path.join(here, "../prisma/migrations/20261114000100_m5_training/migration.sql"), "utf8");
    const guard = /DO \$\$\nDECLARE[\s\S]*?END \$\$;/.exec(sql)?.[0];
    assert.ok(guard, "the migration opens with its guard");
    await db.$executeRawUnsafe(guard!);
    await assert.rejects(
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`ALTER TABLE game_analyses RENAME COLUMN lines TO lines_p5guard`);
        await tx.$executeRawUnsafe(guard!);
      }),
      /M5 preconditions missing .*game_analyses\.lines/,
    );
    const still = await db.$queryRaw<{ ok: boolean }[]>(Prisma.sql`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_analyses' AND column_name = 'lines') AS ok`);
    assert.equal(still[0]!.ok, true, "rolled back");
  });

  it("replay_app (replay_app.p5.sql) writes what the train routes write", { skip: APP_URL ? false : "TEST_APP_DATABASE_URL not set" }, async () => {
    assertLocalTestUrl(APP_URL!);
    const app = createPrismaClient({ datasourceUrl: APP_URL });
    try {
      const u = await makeUser(db, "m5app");
      const m = await upsertMistake(db, u.id, 11n, "2026-11-12T10:00:00.000", "a");
      await card(app, u.id, "m_app1", m.id);
      seq++;
      await attempt(app, u.id, uuid(), null);
      await app.$executeRaw(Prisma.sql`UPDATE mistakes SET "hiddenAt" = now() WHERE id = ${m.id}`);
      await app.$executeRaw(Prisma.sql`DELETE FROM training_cards WHERE "userId" = ${u.id} AND "itemKey" = 'm_app1'`);
      await app.$executeRaw(Prisma.sql`
        INSERT INTO training_days ("userId", day, "bankReviewed", "updatedAt") VALUES (${u.id}, '2026-11-12', 1, now())
        ON CONFLICT ("userId", day) DO UPDATE SET "bankReviewed" = training_days."bankReviewed" + EXCLUDED."bankReviewed"`);
      await app.$executeRaw(Prisma.sql`
        INSERT INTO reports ("referenceId", "reporterId", "targetType", "targetRef", reason) VALUES (${`cr5a${run}${seq}`.slice(0, 25)}, ${u.id}, 'PUZZLE', '0009B', 'OTHER')`);
      const occ = await app.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS n FROM mistake_occurrences WHERE "mistakeId" = ${m.id}`);
      assert.equal(occ[0]!.n, 0n);
    } finally {
      await app.$disconnect();
    }
  });
});
