import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { legendFixture, legendFixtureFacts, legendFixtureMoves } from "@repo/chess-analysis/fixtures/legend";
import { parseKeyRing, verifyInternal, WORKER_POLICY, workerKidMayCall } from "@repo/contracts/internal/auth";
import { KickBodyV1, KICK_PATH } from "@repo/contracts/internal/kick";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { OPERA_GAME_PGN } from "../../prisma/fixtures/design-legend-positions";
import { epdForOpening } from "./opening-epd";
import { enqueueBatchSql, fairSeqs, kickWorker, parseSince, type Candidate } from "./enqueue-analysis";
import { legendFactsFor, type LegendCandidate } from "./legend-facts";

describe("opening-epd", () => {
  it("stores the replayed EPD when it equals the stored fen's", () => {
    const r = epdForOpening("1. e4 e5 2. Nf3", "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2");
    assert.deepEqual(r, { ok: true, epd: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -" });
  });

  it("logs and skips a mismatch, a line that does not replay, an empty line, a bad fen", () => {
    const wrong = epdForOpening("1. e4 e5 2. Nf3", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    assert.equal(wrong.ok, false);
    assert.match((wrong as { reason: string }).reason, /≠/);
    assert.match((epdForOpening("1. e4 Ke7 2. Qh5 Kf9", "x x x x") as { reason: string }).reason, /fen|stops/);
    assert.match((epdForOpening("1. e4 e5 2. Ke3 Kd5", "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2") as { reason: string }).reason, /stops at/);
    assert.match((epdForOpening("", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1") as { reason: string }).reason, /no moves/);
    assert.match((epdForOpening("1. e4", "not a fen") as { reason: string }).reason, /does not parse/);
  });
});

describe("enqueue-analysis", () => {
  const c = (id: number, userId: number): Candidate => ({ id: BigInt(id), ref: `c${id}`, completedAt: new Date(0), userId: BigInt(userId) });

  it("fairSeq ranks each game among its member's candidates (newest first, 1-based)", () => {
    assert.deepEqual(fairSeqs([c(9, 1), c(8, 2), c(7, 1), c(6, 1), c(5, 2)]), [1, 1, 2, 3, 2]);
    assert.deepEqual(fairSeqs([]), []);
  });

  it("--since takes a real calendar day only", () => {
    assert.equal(parseSince(undefined), null);
    assert.equal(parseSince("2026-10-01")!.toISOString(), "2026-10-01T00:00:00.000Z");
    assert.throws(() => parseSince("2026-02-30"), /not a date/);
    assert.throws(() => parseSince("01/10/2026"), /yyyy-mm-dd/);
  });

  it("one statement per batch: insert-or-skip jobs, NONE → QUEUED, the members' gamesVersion", () => {
    const s = enqueueBatchSql([c(3, 1), c(2, 1)], [1, 2]);
    assert.match(s.sql, /ON CONFLICT \("dedupeKey"\) DO NOTHING/);
    assert.match(s.sql, /"analysisStatus" = 'QUEUED'/);
    assert.match(s.sql, /"gamesVersion" = u\."gamesVersion" \+ 1/);
    assert.match(s.sql, /'reason', 'backfill'/);
    assert.match(s.sql, /\(g\."gameData" ->> \?\) IS NULL/, "seeded games (gameData.p3Seed) are excluded");
    assert.ok(s.values.includes("p3Seed"));
    assert.ok(s.values.includes(JOB_PRIORITY.BACKLOG));
    assert.ok(s.values.includes("{1,2}"));
  });

  it("kicks once, signed with ops' worker key opswk, only when the env names a worker and that key", async () => {
    assert.match(await kickWorker({}), /^no kick/);
    const opsKey = Buffer.alloc(32, 7).toString("base64");
    assert.match(await kickWorker({ ANALYSIS_WORKER_URL: "http://localhost:3003", INTERNAL_API_SECRET: `web:${opsKey}` }), /^no kick/);
    let seen: { url: string; headers: Record<string, string>; body: string } | null = null;
    const fakeFetch = (async (url: URL, init: RequestInit) => {
      seen = { url: String(url), headers: init.headers as Record<string, string>, body: String(init.body) };
      return new Response(JSON.stringify({ draining: false, nextRunAt: null }), { status: 202 });
    }) as unknown as typeof fetch;
    assert.match(await kickWorker({ ANALYSIS_WORKER_URL: "http://localhost:3003", INTERNAL_API_SECRET: `ops:${opsKey}` }), /^no kick/);
    const env = { ANALYSIS_WORKER_URL: "http://localhost:3003", INTERNAL_API_SECRET: `web:${Buffer.alloc(32, 1).toString("base64")},opswk:${opsKey}` };
    assert.equal(await kickWorker(env, fakeFetch), "kick → localhost:3003: HTTP 202");
    const req = seen!;
    assert.equal(req.url, `http://localhost:3003${KICK_PATH}`);
    assert.deepEqual(KickBodyV1.parse(JSON.parse(req.body)), { v: 1, reason: "backfill", kinds: ["ANALYZE_GAME"] });
    const v = verifyInternal({ headers: req.headers, method: "POST", path: KICK_PATH, body: req.body, keys: parseKeyRing(`opswk:${opsKey}`), nowMs: Date.now() });
    assert.deepEqual(v, { ok: true, kid: "opswk" });
    assert.ok(workerKidMayCall("opswk", KICK_PATH, WORKER_POLICY));
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    assert.match(await kickWorker(env, failing), /failed \(TypeError\)/);
  });
});

describe("legend-facts", () => {
  const candidate = (name: string, over: Partial<LegendCandidate> = {}): LegendCandidate => {
    const f = legendFixture(name);
    return {
      gameId: 1n,
      userId: 2n,
      color: f.member,
      startingFen: f.startFen,
      startPly: 0,
      moves: legendFixtureMoves(f).join(" "),
      positionId: 3n,
      pgn: f.legendPgn,
      gameMetadata: f.metadata,
      moveNumber: null,
      whiteLegendName: null,
      blackLegendName: null,
      whitePlayerName: name === "opera" ? "Paul Morphy" : "Garry Kasparov",
      blackPlayerName: name === "opera" ? "Duke Karl / Count Isouard" : "Veselin Topalov",
      ...over,
    };
  };

  it("computes exactly the legend fixtures' facts (the writers' shared function)", () => {
    for (const name of ["opera", "kt"]) {
      const f = legendFixture(name);
      const r = legendFactsFor(candidate(name, { startPly: legendFixtureFacts(f).startPly }));
      assert.ok(r.ok, name);
      assert.deepEqual(r.facts, legendFixtureFacts(f), name);
    }
  });

  it("skips, with a reason, what cannot be compared", () => {
    // a score that stops at the position (the content seed's old Opera PGN ended at 9…b5): nothing left to compare
    const toTheStart = '[Result "1-0"]\n\n1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 1-0';
    assert.deepEqual(legendFactsFor(candidate("opera", { pgn: toTheStart })), { ok: false, reason: "line_ends_at_start" });
    // the content seed's Opera score continues to 17.Rd8#: comparable
    assert.equal(legendFactsFor(candidate("opera", { pgn: OPERA_GAME_PGN, startPly: 18 })).ok, true);
    assert.deepEqual(legendFactsFor(candidate("opera", { pgn: null })), { ok: false, reason: "no_pgn" });
    assert.deepEqual(legendFactsFor(candidate("opera", { moves: "" })), { ok: false, reason: "no_moves" });
    assert.deepEqual(legendFactsFor(candidate("opera", { startingFen: "8/8/8/8/8/8/8/K6k w - - 0 1" })), { ok: false, reason: "no_line" });
    assert.deepEqual(legendFactsFor(candidate("opera", { pgn: "1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5" })), {
      ok: false,
      reason: "no_result",
    });
    assert.deepEqual(legendFactsFor(candidate("opera", { whitePlayerName: null })), { ok: false, reason: "no_name" });
    assert.deepEqual(legendFactsFor(candidate("opera", { moves: "c3b5 a1a8" })), { ok: false, reason: "bad_moves" });
  });
});
