import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import { gradeAnalysis } from "@repo/chess-analysis/analysis";
import { INITIAL_FEN } from "@repo/chess-analysis/board";
import { J } from "@repo/chess-analysis/codec";
import { gameAnalysisInput } from "@repo/chess-analysis/fixtures/review-inputs";
import { Ref } from "@repo/contracts/http/common";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { LinesV1, ReviewContentV1 } from "../src/json/review";
import { ShareSnapshotV1, SHARE_CODE_RE } from "../src/json/share";
import {
  buildFixture,
  canonicalJson,
  contentHash,
  goneShares,
  LIVE_SHARE_MIN_LEFT_MS,
  liveShare,
  openingOf,
  oracleGames,
  oracleInput,
  REF_RE,
  SEED_HASH_KEY,
  SEED_MARK,
  seedClocks,
  seededRef,
  seededShareCode,
  seedPgn,
  shareSnapshotOf,
  shareInSeededState,
  shareStillGone,
  SHARE_PRUNE_AFTER_MS,
  type GameSpec,
  type SeedMember,
} from "./builders";

const member: SeedMember = { id: 8n, ref: "cmemberaaaaaaaaaaaaaaaaaa", name: "TestPlayerA E2E", rating: 1184 };
const tal: SeedMember = { id: 100n, ref: "cmembertalaaaaaaaaaaaaaaa", name: "tal_fan_77", rating: 1203 };

function gameSpec(over: Partial<GameSpec> = {}): GameSpec {
  const input = gameAnalysisInput();
  return {
    key: "GAME",
    scope: member.ref,
    member,
    memberColor: "w",
    opponent: { kind: "member", member: tal },
    mode: "ONLINE",
    startFen: INITIAL_FEN,
    moves: input.moves,
    tc: { initialSeconds: 600, incrementSeconds: 0 },
    outcome: "BLACK",
    method: "RESIGNATION",
    completedAt: new Date("2026-11-09T18:42:10.000Z"),
    analysis: {
      kind: "done",
      input: { ...input, members: [{ side: "w", result: "loss" }, { side: "b", result: "win" }] },
      provenance: "design-mock",
      reason: "live_end",
      priority: JOB_PRIORITY.GAME_ENDED,
    },
    tag: "review",
    ...over,
  };
}

describe("seed identities", () => {
  it("seededRef is deterministic, per key and scope, and a valid contracts Ref", () => {
    const a = seededRef("GAME", "cuser1");
    assert.equal(a, seededRef("GAME", "cuser1"));
    assert.notEqual(a, seededRef("CLEAN", "cuser1"));
    assert.notEqual(a, seededRef("GAME", "cuser2"));
    assert.match(a, REF_RE);
    assert.equal(a.length, 25);
    assert.ok(Ref.safeParse(a).success);
  });

  it("seededShareCode is 8 chars of lowercase Crockford base32, deterministic", () => {
    for (let i = 0; i < 200; i++) {
      const c = seededShareCode(`k${i}`, "s");
      assert.match(c, SHARE_CODE_RE);
      assert.equal(c, seededShareCode(`k${i}`, "s"));
    }
    assert.notEqual(seededShareCode("GAME:expired", "s"), seededShareCode("GAME:revoked", "s"));
  });

  it("canonicalJson ignores key order and encodes bigint and Date", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: 2n, c: new Date(0) } }), canonicalJson({ a: { c: new Date(0), d: 2n }, b: 1 }));
    assert.equal(canonicalJson({ x: 5n }), '{"x":"5"}');
    assert.equal(contentHash({ a: 1, b: 2 }), contentHash({ b: 2, a: 1 }));
    assert.notEqual(contentHash({ a: 1 }), contentHash({ a: 2 }));
  });
});

describe("clocks and PGN", () => {
  it("seedClocks: one entry per ply, never below 1 s, increment added", () => {
    const c = seedClocks(80, 180_000, 2_000);
    assert.equal(c.length, 80);
    assert.ok(c.every((ms) => ms >= 1_000 && ms <= 180_000 + 80 * 2_000));
    assert.deepEqual(seedClocks(10, 60_000, 0), seedClocks(10, 60_000, 0));
  });

  it("seedPgn re-parses with chess.js, with SetUp/FEN for a position start", () => {
    const fen = "rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10";
    const pgn = seedPgn({
      ref: "cref",
      event: "e",
      white: "W",
      black: "B",
      startFen: fen,
      san: ["Nxb5", "cxb5", "Bxb5+"],
      clocksMs: [599_000, 598_000, 597_000],
      outcome: "DRAW",
      termination: "Normal",
      timeControl: "600+0",
      date: new Date("2026-11-10T19:05:00Z"),
    });
    assert.match(pgn, /\[SetUp "1"\]/);
    assert.match(pgn, /\[Date "2026\.11\.10"\]/);
    assert.match(pgn, /10\. Nxb5 \{\[%clk 0:09:59\.0\]\}/);
    const c = new Chess();
    c.loadPgn(pgn);
    assert.equal(c.history().length, 3);
  });
});

describe("openings and oracle inputs", () => {
  it("openingOf: the deepest EPD match of the openings data, nothing for a position start", () => {
    assert.deepEqual(openingOf(INITIAL_FEN, gameAnalysisInput().moves), {
      eco: "C59",
      name: "Italian Game: Two Knights Defense, Polerio Defense, Suhle Defense",
    });
    assert.deepEqual(openingOf("8/8/4k3/8/8/4K3/8/R6r w - - 0 1", ["a1a2"]), { eco: null, name: null });
  });

  it("oracleInput: all 30 games have an eval per position (the terminal mate added where Lichess has none)", () => {
    assert.equal(oracleGames().length, 30);
    for (let i = 0; i < 30; i++) {
      const { input } = oracleInput(i, [{ side: "w", result: null }]);
      assert.equal(input.evals.length, input.moves.length + 1, oracleGames()[i]!.id);
      assert.deepEqual(input.members, [{ side: "w", result: null }]);
    }
    // a later call does not see an earlier call's members
    assert.deepEqual(oracleInput(0, []).input.members, []);
  });
});

describe("buildFixture", () => {
  it("the design GAME: what the worker would write, for both member sides", () => {
    const f = buildFixture(gameSpec());
    const g = f.game;
    assert.match(g.ref, REF_RE);
    assert.equal(g.plyCount, 54);
    assert.equal(g.moves.split(" ").length, 54);
    assert.equal(g.moveClocksMs.length, 54);
    assert.equal(g.timeClass, "RAPID");
    assert.equal(g.analysisStatus, "DONE");
    assert.equal(g.ecoCode, "C59");
    assert.equal(g.result, "OPPONENT_WON");
    assert.equal(g.winnerId, tal.id);
    assert.equal(g.gameData[SEED_MARK], "review");
    assert.equal(g.gameData[SEED_HASH_KEY], f.hash);
    assert.equal(f.players.length, 2);
    assert.deepEqual(f.players.map((p) => [p.color, p.result]), [["w", "LOSS"], ["b", "WIN"]]);
    assert.deepEqual(f.members, [member.id, tal.id]);

    const done = gameSpec().analysis as Extract<GameSpec["analysis"], { kind: "done" }>;
    const graded = gradeAnalysis(done.input);
    const a = f.analysis!;
    assert.equal(a.totalPlies, 54);
    assert.equal(a.gradedPlies, 54);
    assert.equal(a.evals.length, 55);
    assert.deepEqual(a.judgements, graded.judgements);
    assert.equal(a.judgements[44], J.GOOD, "23.Rxf6 (ply 44) is GOOD: the grader's label, not the plan's INACCURACY");
    assert.equal(a.accuracyWhite, graded.accuracy.w);
    assert.ok(LinesV1.safeParse(a.lines).success);
    assert.equal(f.players[0]!.accuracy, graded.accuracy.w);
    assert.equal(f.players[0]!.counts.length, 13);
    assert.equal(f.players[0]!.phaseAccuracy.length, 3);
    assert.equal(f.reviews.length, 2);
    for (const r of f.reviews) assert.ok(ReviewContentV1.safeParse(r.content).success);
    assert.deepEqual(f.reviews.find((r) => r.color === "w")!.content.moments.map((m) => m.ply), [32, 36, 40]);
    assert.equal(f.job?.status, "DONE");
    assert.deepEqual(f.expect, { analysisStatus: "DONE", job: "doneOrPruned", analysis: true, reviews: 2, legend: [] });
  });

  it("is deterministic, and the hash follows the definition", () => {
    assert.equal(buildFixture(gameSpec()).hash, buildFixture(gameSpec()).hash);
    assert.notEqual(buildFixture(gameSpec()).hash, buildFixture(gameSpec({ member: { ...member, rating: 1300 } })).hash);
  });

  it("an unanalysed game has no opening, analysis, review or job", () => {
    const f = buildFixture(gameSpec({ key: "U", analysis: { kind: "none" } }));
    assert.equal(f.game.analysisStatus, "NONE");
    assert.equal(f.game.ecoCode, null);
    assert.equal(f.analysis, null);
    assert.equal(f.reviews.length, 0);
    assert.equal(f.job, null);
    assert.equal(f.players[0]!.accuracy, null);
    assert.equal(f.players[0]!.momentsCount, 0);
  });

  it("the terminal failure: partial arrays as a checkpoint leaves them, the job out of attempts", () => {
    const input = gameAnalysisInput();
    const f = buildFixture(
      gameSpec({
        key: "T",
        mode: "BOT",
        opponent: { kind: "bot", elo: 1400 },
        analysis: { kind: "terminal", input: { ...input, members: [{ side: "w", result: "loss" }] }, provenance: "design-mock", gradedPlies: 30, lastError: "engine_failed: x" },
      }),
    );
    const a = f.analysis!;
    assert.equal(f.game.analysisStatus, "FAILED");
    assert.equal(a.gradedPlies, 30);
    assert.equal(a.failedAtPly, 30);
    assert.equal(a.evals.length, 31);
    assert.equal(a.best.length, 30);
    assert.equal(a.judgements.length, 30);
    assert.equal(a.completedAt, null);
    assert.deepEqual(f.job && [f.job.status, f.job.attempts, f.job.maxAttempts], ["FAILED", 4, 4]);
    assert.deepEqual(f.expect.job, { status: "FAILED", attempts: 4 });
    assert.equal(f.reviews.length, 0);
    assert.equal(f.players.length, 1);
    assert.equal(f.game.opponentId, null);
  });

  it("bot games: the ladder name and the legacy bot user as opponentId", () => {
    const f = buildFixture(
      gameSpec({ key: "B", mode: "BOT", opponent: { kind: "bot", elo: 1200 }, botUserId: 1n, tc: null, analysis: { kind: "none" } }),
    );
    assert.equal(f.game.blackName, "Engine 1200");
    assert.equal(f.game.botElo, 1200);
    assert.equal(f.game.opponentId, 1n);
    assert.equal(f.game.timeClass, "UNTIMED");
    assert.deepEqual(f.game.moveClocksMs, []);
    assert.equal(f.players[0]!.opponentName, "Engine 1200");
  });

  it("refuses inconsistent definitions", () => {
    assert.throws(() => buildFixture(gameSpec({ mode: "BOT" })), /disagree/);
    assert.throws(() => buildFixture(gameSpec({ tc: null, analysis: { kind: "none" } })), /untimed/);
    const input = gameAnalysisInput();
    assert.throws(
      () => buildFixture(gameSpec({ analysis: { kind: "done", input: { ...input, members: [{ side: "w", result: "loss" }] }, provenance: "design-mock", reason: "live_end", priority: JOB_PRIORITY.GAME_ENDED } })),
      /every member side/,
    );
    assert.throws(() => buildFixture(gameSpec({ analysis: { kind: "skipped" } })), /SKIPPED/);
  });
});

describe("shares", () => {
  const f = buildFixture(gameSpec());

  it("the snapshot masks a member opponent and parses as ShareSnapshotV1", () => {
    const s = shareSnapshotOf(f, "w", true);
    assert.ok(ShareSnapshotV1.safeParse(s).success);
    assert.equal(s.players.w.name, member.name);
    assert.equal(s.players.b.name, "Opponent (1203)");
    assert.equal(s.result, "0-1");
    assert.equal(s.endLabel, "0–1 resigned");
    assert.equal(s.tcLabel, "Rapid 10+0");
    assert.equal(s.playedOn, "2026-11-09");
    assert.equal(s.j.length, 54);
    assert.equal(s.moment?.ply, 40);
    assert.equal(s.moment?.judgement, J.BLUNDER);
    const json = JSON.stringify(s);
    assert.ok(!json.includes(f.game.ref) && !json.includes(tal.ref), "no refs in a public snapshot");
    assert.equal(shareSnapshotOf(f, "w", false).players.w.name, "A Replay Chess player");
  });

  it("goneShares: one expired inside the prune window, one revoked", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    const [expired, revoked] = goneShares(f, "w", member.ref, now);
    assert.ok(expired!.expiresAt < now && expired!.revokedAt === null);
    assert.ok(revoked!.revokedAt !== null && revoked!.revokedAt < now);
    assert.ok(shareStillGone("expired", expired, now));
    assert.ok(shareStillGone("revoked", revoked, now));
    // close to the prune it is rewritten, and a missing or reopened row is too
    assert.ok(!shareStillGone("expired", { expiresAt: new Date(now.getTime() - SHARE_PRUNE_AFTER_MS + 3_600_000), revokedAt: null }, now));
    assert.ok(!shareStillGone("expired", undefined, now));
    assert.ok(!shareStillGone("revoked", { expiresAt: revoked!.expiresAt, revokedAt: null }, now));
  });

  it("liveShare: a fixed code, open for 30 days, re-dated once less than a week is left", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    const live = liveShare(f, "w", member.ref, now);
    assert.equal(live.code, liveShare(f, "w", member.ref, new Date("2027-01-01T00:00:00Z")).code, "same code on every run");
    assert.notEqual(live.code, goneShares(f, "w", member.ref, now)[0]!.code);
    assert.equal(live.revokedAt, null);
    assert.ok(live.createdAt < now && live.expiresAt.getTime() - now.getTime() > 29 * 24 * 3_600_000);
    assert.ok(shareInSeededState("live", live, now));
    const later = new Date(live.expiresAt.getTime() - LIVE_SHARE_MIN_LEFT_MS + 60_000);
    assert.ok(!shareInSeededState("live", live, later), "less than a week left → rewritten");
    assert.ok(!shareInSeededState("live", { ...live, revokedAt: now }, now), "revoked by a test → rewritten");
    assert.ok(!shareInSeededState("live", undefined, now));
  });
});
