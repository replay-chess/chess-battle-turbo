/**
 * The Phase 6 backfills (phase-06 plan 6.6) on a real Postgres after `prisma migrate deploy` (M6 included), with the
 * rows real games leave behind:
 *   - 62 rated CC0 Lichess games (`@repo/chess-fixtures/import/source/cc0-pool.json`: real moves, the real per-ply
 *     clocks, Lichess's engine evals) and 10 oracle games (real best moves, so the errors carry themes), played between
 *     two members in different zones (Asia/Kolkata, America/New_York), graded by the worker's grader and written with
 *     every row the worker writes (games, game_players with accuracy, game_analyses, player_reviews, the ANALYZE_GAME
 *     job) by the P3 seed writer; blitz, rapid and bullet, wins, losses and draws, five months of play;
 *   - bank mistakes extracted from those games by the product's own A6 path (`addMomentMistake`: the J1 extraction and
 *     the web's writer), one per review moment of either member;
 *   - two members with three analysed games each (under B-W3's threshold) and an unanalysed game.
 * Checks: B-W1 dry run / apply in keyset batches / the stored columns equal a recomputation and the CA golden pins /
 * an inconsistent analysis is left at 0 / a second apply writes 0 rows; B-W2 tags exactly the mistakes with an
 * occurrence under a minute (recomputed here from the stored clocks), never changes primaryTheme, and a second apply
 * tags 0; B-W3 arms the shared upsert for the members who need it, not twice, and --verify's count; one audit row per
 * applied run.
 * Isolation as P5's backfill test: `jobs` and `audit_logs` are copied into a private schema and the writes that touch
 * them run in a transaction with `SET LOCAL search_path = <schema>, public`; the members are this file's own users (the
 * scripts' member scope). Skipped unless TEST_DATABASE_URL is set (a local Docker Postgres or the CI service; never Neon).
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Prisma, PrismaClient } from "@repo/db";
import { buildFixture, oracleEnding, oracleGames, oracleInput, type SeedMember } from "@repo/db/seed/builders";
import { writeFixtures } from "@repo/db/seed/writer";
import { INITIAL_FEN } from "@repo/chess-analysis/board";
import { CC0_CASES, cc0Game, cc0TimedIndexes, weaknessInputsGolden } from "@repo/chess-analysis/fixtures/weakness-inputs";
import { WEAKNESS_INPUTS_VERSION, computeSideInputs } from "@repo/chess-analysis/weakness-inputs";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { addMomentMistake } from "../../lib/train/momentMistake.server";
import type { BackfillDb } from "./p04-common";
import { countInputCandidates, runWeaknessInputs, verifyStoredInputs } from "./backfill-weakness-inputs";
import { TIME_PRESSURE_THEME, countOccurrences, runTimePressure } from "./backfill-mistake-timepressure";
import { recordP6Backfill } from "./p06-common";

const url = process.env.TEST_DATABASE_URL;
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const SCHEMA = `p06bf_${RUN}`;
const NOW = new Date("2026-11-17T19:00:00.000Z");
const DAY = 86_400_000;
const PROFILE = { dayStartHour: 4, releaseHour: 8, bankDailyCap: 10, newPerDay: 5 };

type Outcome = "WHITE" | "BLACK" | "DRAW" | "NONE";
const METHOD: Record<string, "CHECKMATE" | "RESIGNATION" | "TIMEOUT" | "AGREEMENT" | "STALEMATE" | "ABANDONED"> = {
  mate: "CHECKMATE",
  resign: "RESIGNATION",
  outoftime: "TIMEOUT",
  timeout: "ABANDONED",
  draw: "AGREEMENT",
  stalemate: "STALEMATE",
};
const TC: Record<string, number> = { bullet: 60, blitz: 300, rapid: 600, classical: 1800 };

describe("Phase 6 backfills (Postgres, real games)", { skip: url && LOCAL.has(new URL(url).hostname) ? false : "TEST_DATABASE_URL (local) not set" }, () => {
  let prisma: PrismaClient;
  const users: bigint[] = [];
  let a: SeedMember;
  let b: SeedMember;
  let c: SeedMember;
  let d: SeedMember;
  /** CC0 index → (fixture ref, member A's colour). */
  const cc0Games = new Map<number, { ref: string; aColor: "w" | "b" }>();
  let corruptGameId = 0n;
  let precomputed: { gameId: bigint; userId: bigint } | null = null;

  const q = <T = Record<string, unknown>>(sql: Prisma.Sql) => prisma.$queryRaw<T[]>(sql);
  const scoped = <T>(fn: (tx: BackfillDb) => Promise<T>) =>
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path = ${SCHEMA}, public`);
        return fn(tx as unknown as BackfillDb);
      },
      { timeout: 120_000 },
    );
  const scope = () => ({ userIds: users });

  async function member(label: string, zone: string, rating: number): Promise<SeedMember> {
    const n = users.length + 1;
    const ref = `cp6bf${RUN}${String(n).padStart(4, "0")}`.slice(0, 25).padEnd(21, "0");
    const [r] = await q<{ id: bigint }>(Prisma.sql`
      INSERT INTO users ("referenceId", code, "googleId", email, name, "timeZone", "updatedAt")
      VALUES (${ref}, ${`code-${RUN}-${n}`}, ${`g-${RUN}-${n}`}, ${`${label}-${RUN}@test.invalid`}, ${`${label}_${n}`}, ${zone}, now())
      RETURNING id`);
    users.push(r!.id);
    return { id: r!.id, ref, name: `${label}_${n}`, rating };
  }

  const outcomeOf = (winner: string | null | undefined): Outcome => (winner === "white" ? "WHITE" : winner === "black" ? "BLACK" : "DRAW");
  const resultOf = (o: Outcome, side: "w" | "b") => (o === "DRAW" || o === "NONE" ? "draw" : (o === "WHITE") === (side === "w") ? "win" : "loss");

  before(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    for (const t of ["jobs", "audit_logs"]) await prisma.$executeRawUnsafe(`CREATE TABLE ${SCHEMA}.${t} (LIKE public.${t} INCLUDING ALL)`);
    a = await member("weak-a", "Asia/Kolkata", 1450);
    b = await member("weak-b", "America/New_York", 1510);
    c = await member("weak-c", "Europe/London", 1200);
    d = await member("weak-d", "UTC", 1250);

    const fixtures = [];
    const timed = cc0TimedIndexes();
    for (const [k, i] of timed.entries()) {
      const g = cc0Game(i);
      const aColor = k % 2 === 0 ? "w" : "b";
      const outcome = outcomeOf(g.winner);
      const pair = k >= timed.length - 3 ? { m: c, o: d } : { m: a, o: b };
      const f = buildFixture({
        key: `p6bf-cc0-${i}`,
        scope: RUN,
        member: pair.m,
        memberColor: aColor,
        opponent: { kind: "member", member: pair.o },
        mode: "ONLINE",
        startFen: INITIAL_FEN,
        moves: g.input.moves,
        tc: { initialSeconds: g.initialTimeSeconds, incrementSeconds: g.incrementSeconds },
        outcome,
        method: METHOD[g.status] ?? "RESIGNATION",
        completedAt: new Date(NOW.getTime() - (k + 1) * 2.3 * DAY),
        analysis: {
          kind: "done",
          input: { ...g.input, members: [{ side: "w", result: resultOf(outcome, "w") }, { side: "b", result: resultOf(outcome, "b") }] },
          provenance: "lichess-oracle",
          reason: "live_end",
          priority: JOB_PRIORITY.GAME_ENDED,
        },
        tag: "p6-backfill",
      });
      // The real clock record of the export (the import mapper's rule), not the seed's synthetic one.
      f.game.moveClocksMs = g.moveClocksMs;
      fixtures.push(f);
      if (pair.m === a) cc0Games.set(i, { ref: f.game.ref, aColor });
    }
    const oracles = oracleGames();
    for (let k = 0; k < 10; k++) {
      const { game, input } = oracleInput(k, []);
      const { outcome, method } = oracleEnding(game);
      const aColor = k % 2 === 0 ? "b" : "w";
      fixtures.push(
        buildFixture({
          key: `p6bf-oracle-${oracles[k]!.id}`,
          scope: RUN,
          member: a,
          memberColor: aColor,
          opponent: { kind: "member", member: b },
          mode: "FRIEND",
          startFen: INITIAL_FEN,
          moves: input.moves,
          tc: { initialSeconds: TC[game.speed] ?? 600, incrementSeconds: 0 },
          outcome,
          method,
          completedAt: new Date(NOW.getTime() - (k + 0.5) * 9 * DAY),
          analysis: {
            kind: "done",
            input: { ...input, members: [{ side: "w", result: resultOf(outcome, "w") }, { side: "b", result: resultOf(outcome, "b") }] },
            provenance: "lichess-oracle",
            reason: "live_end",
            priority: JOB_PRIORITY.GAME_ENDED,
          },
          tag: "p6-backfill",
        }),
      );
    }
    const unanalysed = cc0Game(timed[0]!);
    fixtures.push(
      buildFixture({
        key: "p6bf-unanalysed",
        scope: RUN,
        member: a,
        memberColor: "w",
        opponent: { kind: "member", member: b },
        mode: "ONLINE",
        startFen: INITIAL_FEN,
        moves: unanalysed.input.moves,
        tc: { initialSeconds: 300, incrementSeconds: 3 },
        outcome: outcomeOf(unanalysed.winner),
        method: "RESIGNATION",
        completedAt: new Date(NOW.getTime() - 3 * DAY),
        analysis: { kind: "none" },
        tag: "p6-backfill",
      }),
    );
    assert.equal(await writeFixtures(prisma, fixtures), fixtures.length);

    // An analysis whose arrays no longer fit the game (a partial or corrupt row): B-W1 must leave it at 0.
    const [bad] = await q<{ id: bigint }>(Prisma.sql`SELECT g.id FROM games g WHERE g."referenceId" = ${cc0Games.get(timed[2]!)!.ref}`);
    corruptGameId = bad!.id;
    await prisma.$executeRaw(Prisma.sql`UPDATE game_analyses SET evals = evals[1:10] WHERE "gameId" = ${corruptGameId}`);
    // A side the worker already wrote (version 1): never overwritten.
    const [pre] = await q<{ gameId: bigint; userId: bigint }>(Prisma.sql`
      SELECT gp."gameId", gp."userId" FROM game_players gp JOIN games g ON g.id = gp."gameId"
       WHERE g."referenceId" = ${cc0Games.get(timed[4]!)!.ref} AND gp."userId" = ${b.id}`);
    precomputed = pre!;
    await prisma.$executeRaw(Prisma.sql`UPDATE game_players SET "weaknessInputsV" = 1, stats = '{7}'
                                         WHERE "gameId" = ${pre!.gameId} AND "userId" = ${pre!.userId}`);
  });

  after(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    if (users.length) {
      const ids = users.map(String);
      await prisma.$executeRaw(Prisma.sql`DELETE FROM jobs WHERE "userId" = ANY(${ids}::bigint[])`);
      await prisma.$executeRaw(Prisma.sql`DELETE FROM games WHERE "creatorId" = ANY(${ids}::bigint[])`);
      await prisma.$executeRaw(Prisma.sql`DELETE FROM users WHERE id = ANY(${ids}::bigint[])`);
    }
    await prisma.$disconnect();
  });

  it("B-W1: computes every analysed side once, as the worker would, and a second apply writes nothing", async () => {
    const [truth] = await q<{ analysed: number }>(Prisma.sql`
      SELECT count(*)::int AS analysed FROM game_players WHERE accuracy IS NOT NULL AND "userId" = ANY(${users.map(String)}::bigint[])`);
    const analysed = truth!.analysed;
    assert.ok(analysed >= 140, `${analysed} analysed sides`);

    const dry = await countInputCandidates(prisma, scope());
    assert.deepEqual(dry, { sides: analysed - 1, members: 4 }, "every analysed side but the one already at version 1");

    const r = await runWeaknessInputs(prisma, { ...scope(), limit: 40 });
    assert.equal(r.seen, analysed - 1);
    assert.equal(r.failed, 2, "both sides of the game whose analysis does not fit");
    assert.equal(r.written, analysed - 3);
    assert.ok(r.batches >= 4, `keyset batches: ${r.batches}`);
    assert.ok(r.failures.every((f) => f.startsWith(`${corruptGameId}:`)), r.failures.join("; "));
    // regression: weakness-heal-pv-bias (FIX-2): every game with a side tagged from stored data alone (an error with no
    // stored line: the best move only) gets one `weakness_lines` ANALYZE_GAME row (HOUSEKEEPING, no userId, its own
    // dedupe key); the game's analysis status and its analysis job are untouched (the review stays readable and bankable).
    assert.ok(r.regrades > 0, "lines refreshes armed");
    const lines = await q<{ gameId: bigint; dedupeKey: string; priority: number; status: string; userId: bigint | null; analysisStatus: string }>(Prisma.sql`
      SELECT j."gameId", j."dedupeKey", j.priority, j.status::text AS status, j."userId", g."analysisStatus"::text AS "analysisStatus"
        FROM jobs j JOIN games g ON g.id = j."gameId"
       WHERE j.kind = 'ANALYZE_GAME' AND j.payload->>'reason' = 'weakness_lines'
         AND j."gameId" IN (SELECT "gameId" FROM game_players WHERE "userId" = ANY(${users.map(String)}::bigint[]))`);
    assert.equal(lines.length, r.regrades);
    assert.ok(
      lines.every((j) => j.status === "QUEUED" && j.priority === JOB_PRIORITY.HOUSEKEEPING && j.userId === null && j.dedupeKey === `weaklines:${j.gameId}` && j.analysisStatus === "DONE"),
      JSON.stringify(lines[0], (_k, v) => (typeof v === "bigint" ? String(v) : v)),
    );
    // Every written side equals computeSideInputs over its stored rows, read back independently.
    const rows = await q<{
      startingFen: string;
      startPly: number;
      moves: string;
      moveClocksMs: number[];
      initialTimeSeconds: number;
      timeClass: string;
      evals: number[];
      best: number[];
      judgements: number[];
      lines: Record<string, { pv: string }> | null;
      middlegamePly: number | null;
      endgamePly: number | null;
      color: "w" | "b";
      result: "WIN" | "LOSS" | "DRAW";
      stats: number[];
      errorLog: number[];
      errorThemeN: number[];
      errorThemes: string[];
      v: number;
      ref: string;
      userId: bigint;
    }>(Prisma.sql`
      SELECT g."startingFen", g."startPly", g.moves, g."moveClocksMs", g."initialTimeSeconds", g."timeClass"::text AS "timeClass",
             ga.evals, ga.best, ga.judgements, ga.lines, ga."middlegamePly", ga."endgamePly", gp.color, gp.result::text AS result,
             gp.stats, gp."errorLog", gp."errorThemeN", gp."errorThemes", gp."weaknessInputsV" AS v, g."referenceId" AS ref, gp."userId"
        FROM game_players gp JOIN games g ON g.id = gp."gameId" JOIN game_analyses ga ON ga."gameId" = gp."gameId"
       WHERE gp."userId" = ANY(${users.map(String)}::bigint[]) AND gp."weaknessInputsV" = ${WEAKNESS_INPUTS_VERSION}
         AND NOT (gp."gameId" = ${precomputed!.gameId} AND gp."userId" = ${precomputed!.userId})`);
    assert.equal(rows.length, analysed - 3);
    let errors = 0;
    let themed = 0;
    let underMinute = 0;
    for (const row of rows) {
      const want = computeSideInputs(row, row, { color: row.color, result: row.result });
      assert.deepEqual([row.stats, row.errorLog, row.errorThemeN, row.errorThemes], [want.stats, want.errorLog, want.errorThemeN, want.errorThemes], row.ref);
      errors += row.errorLog.length;
      themed += row.errorThemes.length;
      underMinute += row.errorLog.filter((e) => ((e >> 7) & 7) === 4).length;
    }
    assert.ok(errors > 150 && themed > 10 && underMinute > 10, `errors ${errors}, theme entries ${themed}, errors under a minute ${underMinute}`);

    // The call-site pin: the CA golden outputs (computed from the export directly) equal what B-W1 stored.
    const golden = weaknessInputsGolden();
    for (const [i, color] of CC0_CASES) {
      const g = cc0Games.get(i);
      assert.ok(g, `CC0 game ${i} is in the fixture set`);
      const userId = g.aColor === color ? a.id : b.id;
      const row = rows.find((x) => x.ref === g.ref && x.userId === userId);
      assert.ok(row, `cc0-${i}-${color}`);
      assert.deepEqual(
        { stats: row.stats, errorLog: row.errorLog, errorThemeN: row.errorThemeN, errorThemes: row.errorThemes },
        golden[`cc0-${i}-${color}`],
        `cc0-${i}-${color}`,
      );
    }

    const [kept] = await q<{ stats: number[]; v: number }>(Prisma.sql`
      SELECT stats, "weaknessInputsV" AS v FROM game_players WHERE "gameId" = ${precomputed!.gameId} AND "userId" = ${precomputed!.userId}`);
    assert.deepEqual(kept, { stats: [7], v: 1 }, "a row already at version 1 is never rewritten");
    const [unanalysed] = await q<{ n: number; touched: number }>(Prisma.sql`
      SELECT count(*)::int AS n, count(*) FILTER (WHERE "weaknessInputsV" <> 0 OR cardinality(stats) > 0)::int AS touched
        FROM game_players WHERE "userId" = ${a.id} AND accuracy IS NULL`);
    assert.deepEqual(unanalysed, { n: 1, touched: 0 }, "an unanalysed side is not touched");

    const again = await runWeaknessInputs(prisma, scope());
    assert.deepEqual([again.written, again.failed, again.seen], [0, 2, 2], "a second apply changes 0 rows");
    assert.deepEqual(await countInputCandidates(prisma, scope()), { sides: 2, members: 2 });

    const checks = await verifyStoredInputs(prisma, 25, scope());
    assert.equal(checks.length, 25);
    assert.ok(checks.every((x) => x.matches || (x.gameId === String(precomputed!.gameId) && x.userId === String(precomputed!.userId))));

    await scoped((tx) => recordP6Backfill(tx, "weakness_inputs", { sides: r.seen, written: r.written, failed: r.failed }));
    const audits = await q<{ action: string; meta: Record<string, number> }>(Prisma.sql`SELECT action, meta FROM ${Prisma.raw(SCHEMA)}.audit_logs`);
    assert.deepEqual(audits.map((x) => x.action), ["backfill.weakness_inputs"]);
  });

  it("B-W2: tags exactly the bank mistakes made under a minute, once, and never their primary theme", async () => {
    // Both members' banks, written by the product's own A6 path (J1 extraction + the web writer), one per review moment.
    const pair = [a.id, b.id];
    const zone = new Map([[a.id, "Asia/Kolkata"], [b.id, "America/New_York"]]);
    const moments = await q<{ gameId: bigint; userId: bigint; ply: number }>(Prisma.sql`
      SELECT gp."gameId", gp."userId", (mo->>'ply')::int AS ply
        FROM game_players gp
        JOIN player_reviews pr ON pr."gameId" = gp."gameId" AND pr.color = gp.color
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pr.content->'moments', '[]'::jsonb)) mo
       WHERE gp."userId" = ANY(${pair.map(String)}::bigint[]) AND gp."gameId" <> ${corruptGameId}
       ORDER BY 1, 2, 3`);
    let banked = 0;
    for (const m of moments) {
      const input = { gameId: m.gameId, userId: m.userId, ply: m.ply, now: NOW, timeZone: zone.get(m.userId)!, profile: PROFILE };
      if (await addMomentMistake(prisma, input)) banked++;
    }
    assert.ok(banked >= 30, `${banked} mistakes banked from ${moments.length} moments`);

    // Expected from the stored clocks, written out here: the member's clock before ply p is the same side's value two
    // plies back (or the initial time); under 60 000 ms is time pressure.
    const occ = await q<{ mistakeId: bigint; ply: number; clocks: number[]; initial: number; themes: string[]; primary: string }>(Prisma.sql`
      SELECT o."mistakeId", o.ply::int AS ply, g."moveClocksMs" AS clocks, g."initialTimeSeconds" AS initial, m.themes, m."primaryTheme" AS primary
        FROM mistake_occurrences o JOIN mistakes m ON m.id = o."mistakeId" JOIN games g ON g.id = o."gameId"
       WHERE m."userId" = ANY(${pair.map(String)}::bigint[])`);
    const expected = new Set<string>();
    for (const o of occ) {
      const ms = o.clocks.length === 0 ? null : o.ply >= 2 ? (o.clocks[o.ply - 2] ?? null) : o.initial * 1000;
      if (ms !== null && ms < 60_000) expected.add(String(o.mistakeId));
    }
    const primaryBefore = new Map(occ.map((o) => [String(o.mistakeId), o.primary]));
    const already = new Set(occ.filter((o) => o.themes.includes(TIME_PRESSURE_THEME)).map((o) => String(o.mistakeId)));
    assert.ok(expected.size >= 3 && expected.size < primaryBefore.size, `${expected.size} of ${primaryBefore.size} mistakes under a minute`);

    const counts = await countOccurrences(prisma, { userIds: pair });
    assert.equal(counts.mistakes, primaryBefore.size - already.size);
    const dry = await runTimePressure(prisma, { userIds: pair, apply: false });
    assert.equal(dry.tagged, [...expected].filter((id) => !already.has(id)).length);
    const [untouched] = await q<{ n: number }>(Prisma.sql`
      SELECT count(*)::int AS n FROM mistakes WHERE "userId" = ANY(${pair.map(String)}::bigint[]) AND ${TIME_PRESSURE_THEME} = ANY(themes)`);
    assert.equal(untouched!.n, already.size, "the dry run writes nothing");

    const r = await runTimePressure(prisma, { userIds: pair, apply: true, limit: 10 });
    assert.ok(r.batches >= 3, `keyset batches: ${r.batches}`);
    assert.equal(r.tagged, dry.tagged);
    const after = await q<{ id: bigint; themes: string[]; primary: string }>(Prisma.sql`
      SELECT id, themes, "primaryTheme" AS primary FROM mistakes WHERE "userId" = ANY(${pair.map(String)}::bigint[])`);
    const tagged = new Set(after.filter((m) => m.themes.includes(TIME_PRESSURE_THEME)).map((m) => String(m.id)));
    assert.deepEqual([...tagged].sort(), [...expected].sort());
    for (const m of after) {
      assert.equal(m.primary, primaryBefore.get(String(m.id)), "primaryTheme never changes");
      assert.ok(m.themes.filter((t) => t === TIME_PRESSURE_THEME).length <= 1);
    }

    const again = await runTimePressure(prisma, { userIds: pair, apply: true });
    assert.equal(again.tagged, 0, "a second apply changes 0 rows");
    await scoped((tx) => recordP6Backfill(tx, "mistake_time_pressure", { occurrences: r.seen, tagged: r.tagged }));
  });
});
