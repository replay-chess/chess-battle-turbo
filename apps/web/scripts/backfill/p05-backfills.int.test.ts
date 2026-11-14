/**
 * The Phase 5 backfills (phase-05 plan 6.7) on a real Postgres after `prisma migrate deploy`:
 *   - B-M5-1 enqueue-mistake-extraction: the dry run writes nothing and counts the analysed game sides with
 *     bankVersion < EXTRACT_VERSION; the apply inserts one EXTRACT_MISTAKES job per side (the contract's dedupe key,
 *     the ids as decimal strings, priority BACKLOG, three attempts, fairSeq per member), across keyset batches; a second
 *     apply inserts nothing; a side already extracted, a skipped game and an unanalysed game are left out;
 *   - B-M5-2 recount-bank-themes: a drifted bankCount and a stray count are fixed, then nothing changes;
 *   - rebuild-cards: a moment ply's missing card is re-created like the worker's (item key, NEW, next release,
 *     bankCount + 1); opt-outs and hidden mistakes stay without one; a second apply creates nothing;
 *   - every applied run writes one audit_logs row.
 * Isolation as P4's backfill test: `jobs` and `audit_logs` are copied into a private schema and every run happens in a
 * transaction with `SET LOCAL search_path = <schema>, public`; the members are this file's own users (the scripts'
 * member scope), so other integration files writing at the same time cannot change the counts. Skipped unless
 * TEST_DATABASE_URL is set (a local Docker Postgres or the CI service; never Neon).
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Prisma, PrismaClient } from "@repo/db";
import { epdHash } from "@repo/chess-analysis/epd";
import { mistakeItemKey } from "@repo/chess-training/items";
import { nextRelease } from "@repo/chess-training/release";
import { EXTRACT_VERSION, extractMistakesDedupeKey, JOB_MAX_ATTEMPTS, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { countCandidates, runEnqueueExtraction, spotCheck } from "./enqueue-mistake-extraction";
import type { BackfillDb } from "./p04-common";
import { recordP5Backfill } from "./p05-common";
import { runRebuild } from "./rebuild-cards";
import { runRecount } from "./recount-bank-themes";

const url = process.env.TEST_DATABASE_URL;
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const SCHEMA = `p05bf_${RUN}`;
const NOW = new Date("2026-11-12T19:00:00.000Z");
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const FENS = [
  "r2r2k1/p1q2pp1/2pb1n1p/5b2/2n5/2NNB2P/PPP1BPP1/R2Q1RK1 w - - 0 17",
  "r2r2k1/p1q2pp1/2p2n1p/5b2/8/1PNNP1bP/P1P1B1P1/R2Q1RK1 w - - 0 19",
  "r3r1k1/p1q2ppb/2p2n1p/8/8/1PNNPBbP/P1PQ2P1/R4RK1 w - - 0 21",
];

describe("Phase 5 backfills (Postgres)", { skip: url && LOCAL.has(new URL(url).hostname) ? false : "TEST_DATABASE_URL (local) not set" }, () => {
  let prisma: PrismaClient;
  const users: bigint[] = [];
  let n = 0;

  const q = <T = Record<string, unknown>>(sql: Prisma.Sql) => prisma.$queryRaw<T[]>(sql);
  /** A run in its own transaction, with the private jobs and audit_logs first on the search path. */
  const scoped = <T>(fn: (tx: BackfillDb) => Promise<T>) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path = ${SCHEMA}, public`);
      return fn(tx as unknown as BackfillDb);
    });

  async function user(label: string): Promise<bigint> {
    n++;
    const [r] = await q<{ id: bigint }>(Prisma.sql`
      INSERT INTO users ("referenceId", code, "googleId", email, name, "timeZone", "updatedAt")
      VALUES (${`cp5bf${RUN}${String(n).padStart(4, "0")}`.slice(0, 25).padEnd(21, "0")}, ${`code-${RUN}-${n}`}, ${`g-${RUN}-${n}`},
              ${`${label}-${RUN}-${n}@test.invalid`}, ${`${label}_${n}`}, 'Asia/Kolkata', now())
      RETURNING id`);
    users.push(r!.id);
    return r!.id;
  }

  async function game(white: bigint, black: bigint, status: string, bankVersion = 0): Promise<bigint> {
    n++;
    const [g] = await q<{ id: bigint }>(Prisma.sql`
      INSERT INTO games ("referenceId", "creatorId", "opponentId", status, "startingFen", "initialTimeSeconds",
                         "incrementSeconds", "creatorTimeRemaining", "opponentTimeRemaining", "expiresAt", "updatedAt",
                         mode, "whitePlayerId", "blackPlayerId", "plyCount", "analysisStatus", "completedAt")
      VALUES (${`cg5bf${RUN}${String(n).padStart(4, "0")}`.slice(0, 25).padEnd(21, "0")}, ${white}, ${black}, 'COMPLETED', ${START}, 300, 0, 300, 300,
              now() + interval '1 day', now(), 'FRIEND', ${white}, ${black}, 40, ${status}::"AnalysisStatus",
              now() - (${n}::int * interval '1 minute'))
      RETURNING id`);
    for (const [color, u] of [
      ["w", white],
      ["b", black],
    ] as const) {
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO game_players ("gameId", "userId", color, mode, "endedAt", "bankVersion", "updatedAt")
        VALUES (${g!.id}, ${u}, ${color}, 'FRIEND', now() - (${n}::int * interval '1 minute'), ${bankVersion}::smallint, now())`);
    }
    return g!.id;
  }

  before(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    for (const t of ["jobs", "audit_logs"]) {
      await prisma.$executeRawUnsafe(`CREATE TABLE ${SCHEMA}.${t} (LIKE public.${t} INCLUDING ALL)`);
    }
  });
  after(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    if (users.length) {
      await prisma.$executeRaw(Prisma.sql`DELETE FROM games WHERE "creatorId" = ANY(${users.map(String)}::bigint[])`);
      await prisma.$executeRaw(Prisma.sql`DELETE FROM users WHERE id = ANY(${users.map(String)}::bigint[])`);
    }
    await prisma.$disconnect();
  });

  it("B-M5-1: dry run, apply in keyset batches, second apply idempotent, the contract's jobs", async () => {
    const a = await user("ea");
    const b = await user("eb");
    const c = await user("ec");
    const done = [await game(a, b, "DONE"), await game(a, b, "DONE"), await game(b, c, "DONE")];
    await game(a, c, "SKIPPED");
    await game(a, c, "NONE");
    const extracted = await game(c, a, "DONE", EXTRACT_VERSION);
    const scope = { userIds: [a, b, c] };

    const dry = await scoped((tx) => countCandidates(tx, scope));
    assert.deepEqual(dry, { sides: 6, members: 3 });
    const none = await q<{ n: number }>(Prisma.sql`SELECT count(*)::int AS n FROM ${Prisma.raw(SCHEMA)}.jobs`);
    assert.equal(none[0]!.n, 0, "the dry run writes nothing");

    const r = await scoped((tx) => runEnqueueExtraction(tx, { ...scope, limit: 4 }));
    assert.deepEqual(r, { batches: 2, seen: 6, inserted: 6 });
    const jobs = await q<{
      kind: string;
      dedupeKey: string;
      priority: number;
      maxAttempts: number;
      fairSeq: number;
      payload: { v: number; gameId: string; userId: string };
      userId: bigint;
      gameId: bigint;
    }>(Prisma.sql`SELECT kind::text AS kind, "dedupeKey", priority, "maxAttempts", "fairSeq", payload, "userId", "gameId"
                    FROM ${Prisma.raw(SCHEMA)}.jobs ORDER BY "gameId", "userId"`);
    assert.equal(jobs.length, 6);
    for (const j of jobs) {
      assert.equal(j.kind, "EXTRACT_MISTAKES");
      assert.equal(j.dedupeKey, extractMistakesDedupeKey(j.gameId, j.userId));
      assert.deepEqual(j.payload, { v: 1, gameId: String(j.gameId), userId: String(j.userId) });
      assert.equal(j.priority, JOB_PRIORITY.BACKLOG);
      assert.equal(j.maxAttempts, JOB_MAX_ATTEMPTS.EXTRACT_MISTAKES);
      assert.ok(j.fairSeq >= 1);
      assert.ok(done.includes(j.gameId), "only DONE games with bankVersion < EXTRACT_VERSION");
    }
    assert.ok(!jobs.some((j) => j.gameId === extracted));

    const again = await scoped((tx) => runEnqueueExtraction(tx, scope));
    assert.equal(again.inserted, 0, "the dedupe key makes a second apply a no-op");
    await scoped((tx) => recordP5Backfill(tx, "mistake_extraction", { sides: r.seen, inserted: r.inserted }));
    const audits = await q<{ action: string }>(Prisma.sql`SELECT action FROM ${Prisma.raw(SCHEMA)}.audit_logs`);
    assert.deepEqual(audits.map((x) => x.action), ["backfill.mistake_extraction"]);

    // After the worker drained the queue (simulated: it sets bankVersion), the predicate is empty.
    await prisma.$executeRaw(Prisma.sql`UPDATE game_players SET "bankVersion" = ${EXTRACT_VERSION}::smallint
                                         WHERE "gameId" = ANY(${done.map(String)}::bigint[])`);
    assert.deepEqual(await scoped((tx) => countCandidates(tx, scope)), { sides: 0, members: 0 });
  });

  async function mistake(userId: bigint, fen: string, ply: number, opts: { hidden?: boolean; puzzle?: boolean; theme?: string } = {}) {
    n++;
    const [m] = await q<{ id: bigint; epdHash: bigint }>(Prisma.sql`
      INSERT INTO mistakes ("referenceId", "userId", "epdHash", color, fen, solution, "playedUci", judgement, source,
                            "isPuzzle", themes, "primaryTheme", phase, "winBefore", "winAfterPlayed", "moveNumber",
                            "lastPlayedAt", "lastOpponentName", "lastPly", "hiddenAt", "updatedAt")
      VALUES (${`cm5bf${RUN}${String(n).padStart(4, "0")}`.slice(0, 25).padEnd(21, "0")}, ${userId}, ${epdHash(fen).toString()}::bigint, 'w', ${fen},
              'd1c1', 'b2b3', 'MISTAKE', 'OWN_ERROR', ${opts.puzzle ?? false}, ARRAY[${opts.theme ?? "fork"}]::text[],
              ${opts.theme ?? "fork"}, 'MIDDLEGAME', 50, 30, ${Math.floor(ply / 2) + 1}, now(), 'opp', ${ply},
              ${opts.hidden ? new Date() : null}, now())
      RETURNING id, "epdHash"`);
    return m!;
  }

  it("rebuild-cards: re-creates a moment's missing card like the worker, never an opt-out's or a hidden mistake's", async () => {
    const u = await user("rc");
    const o = await user("ro");
    const g = await game(u, o, "DONE", EXTRACT_VERSION);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO player_reviews ("gameId", color, content, progress, "textStatus", "createdAt", "updatedAt")
      VALUES (${g}, 'w', '{"v":1,"moments":[{"ply":32},{"ply":36},{"ply":40}]}'::jsonb, '{"v":1,"bankOptOut":[36]}'::jsonb,
              'TEMPLATE', now(), now())`);
    const missing = await mistake(u, FENS[0]!, 32, { puzzle: true, theme: "rc:recapture" });
    const optedOut = await mistake(u, FENS[1]!, 36);
    const hidden = await mistake(u, FENS[2]!, 40, { hidden: true });
    for (const [m, ply] of [
      [missing, 32],
      [optedOut, 36],
      [hidden, 40],
    ] as const) {
      await prisma.$executeRaw(Prisma.sql`INSERT INTO mistake_occurrences ("gameId", ply, "mistakeId") VALUES (${g}, ${ply}::smallint, ${m.id})`);
    }

    const dry = await scoped((tx) => runRebuild(tx, { apply: false, now: NOW, userIds: [u] }));
    assert.deepEqual([dry.missing, dry.created], [1, 0]);
    const r = await scoped((tx) => runRebuild(tx, { apply: true, now: NOW, userIds: [u] }));
    assert.deepEqual([r.missing, r.created], [1, 1]);
    const cards = await q<{ mistakeId: bigint; itemKey: string; kind: string; state: string; due: Date; theme: string }>(
      Prisma.sql`SELECT "mistakeId", "itemKey", kind::text AS kind, state::text AS state, due, theme
                   FROM training_cards WHERE "userId" = ${u}`,
    );
    assert.equal(cards.length, 1);
    assert.equal(cards[0]!.mistakeId, missing.id);
    assert.equal(cards[0]!.itemKey, mistakeItemKey(BigInt(missing.epdHash)));
    assert.deepEqual([cards[0]!.kind, cards[0]!.state, cards[0]!.theme], ["MISTAKE", "NEW", "rc:recapture"]);
    assert.equal(cards[0]!.due.toISOString(), nextRelease(NOW, "Asia/Kolkata", 8).toISOString());
    const tm = await q<{ bankCount: number }>(Prisma.sql`SELECT "bankCount" FROM theme_mastery WHERE "userId" = ${u} AND theme = 'rc:recapture'`);
    assert.equal(tm[0]!.bankCount, 1);
    const again = await scoped((tx) => runRebuild(tx, { apply: true, now: NOW, userIds: [u] }));
    assert.deepEqual([again.missing, again.created], [0, 0]);

    // The spot check of B-M5-1 agrees: 3 moments, 3 occurrences, 1 card expected (36 opted out, 40 hidden) and present.
    const check = await scoped((tx) => spotCheck(tx, 10, { userIds: [u] }));
    assert.deepEqual(
      check.filter((c) => c.gameId === String(g)).map((c) => [c.moments, c.occurrences, c.cardsExpected, c.cards]),
      [[3, 3, 1, 1]],
    );
  });

  it("B-M5-2: a drifted bankCount and a stray count are fixed, then nothing changes", async () => {
    const u = await user("tc");
    const m = await mistake(u, FENS[0]!, 32, { theme: "fork" });
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO training_cards ("userId", deck, kind, "itemKey", "mistakeId", theme, due, "updatedAt")
      VALUES (${u}, 'BANK', 'REVIEW_POSITION', ${mistakeItemKey(BigInt(m.epdHash))}, ${m.id}, 'fork', now(), now())`);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO theme_mastery ("userId", theme, "bankCount") VALUES (${u}, 'fork', 5), (${u}, 'pin', 2)`);
    const dry = await scoped((tx) => runRecount(tx, { apply: false, userIds: [u] }));
    assert.equal(dry.fixed, 2, "fork 5 → 1 and pin 2 → 0");
    const unchanged = await q<{ theme: string; bankCount: number }>(
      Prisma.sql`SELECT theme, "bankCount" FROM theme_mastery WHERE "userId" = ${u} ORDER BY theme`,
    );
    assert.deepEqual(unchanged.map((x) => x.bankCount), [5, 2], "the dry run writes nothing");
    const r = await scoped((tx) => runRecount(tx, { apply: true, userIds: [u] }));
    assert.equal(r.fixed, 2);
    const fixed = await q<{ theme: string; bankCount: number }>(
      Prisma.sql`SELECT theme, "bankCount" FROM theme_mastery WHERE "userId" = ${u} ORDER BY theme`,
    );
    assert.deepEqual(fixed, [
      { theme: "fork", bankCount: 1 },
      { theme: "pin", bankCount: 0 },
    ]);
    assert.equal((await scoped((tx) => runRecount(tx, { apply: true, userIds: [u] }))).fixed, 0);
  });
});
