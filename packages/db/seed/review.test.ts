import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replayUci } from "@repo/chess-analysis/replay";
import { ComparisonFactsV1 } from "../src/json/legend";
import { ReviewContentV1 } from "../src/json/review";
import type { SeedMember } from "./builders";
import { SEED_MARK } from "./builders";
import {
  ARCHIVE_ANALYSED,
  ARCHIVE_FILLERS,
  KT_FEN,
  OPERA_FEN,
  REVIEW_SEED_TAG,
  reviewFixtureRef,
  reviewFixtures,
  terminalFixture,
  writePersonaFixtures,
  type ReviewSeedContext,
} from "./review";
import { perfFixture, perfFixtures, perfKind, perfReviewRefs, PERF_REVIEW_SET } from "./perf-archive";
import { SMOKE_GAME_REF, SMOKE_PLIES, smokeFixture } from "./smoke";

const m = (id: bigint, name: string, rating: number): SeedMember => ({ id, ref: `cmember${String(id).padStart(18, "0")}`, name, rating });
const ctx: ReviewSeedContext = {
  member: m(8n, "TestPlayerA E2E", 1184),
  talFan: m(100n, "tal_fan_77", 1203),
  martin: m(101n, "martin_k", 1212),
  botUserId: 1n,
  operaPositionId: 9n,
  ktPositionId: 10n,
};

describe("the review seed (plan 6.9)", () => {
  const all = reviewFixtures(ctx);
  const byKey = new Map(all.map((f) => [f.key, f]));
  const memberSide = (key: string) => byKey.get(key)!.players.find((p) => p.userId === ctx.member.id)!;

  it("40 games for the member, 25 analysed, unique refs, finished states only", () => {
    assert.equal(all.length, 5 + ARCHIVE_FILLERS);
    assert.equal(all.length, 40);
    assert.equal(all.filter((f) => f.game.analysisStatus === "DONE").length, 2 + ARCHIVE_ANALYSED);
    assert.equal(new Set(all.map((f) => f.game.ref)).size, 40);
    for (const f of all) {
      assert.ok(["DONE", "NONE"].includes(f.game.analysisStatus), `${f.key}: ${f.game.analysisStatus}`);
      assert.ok(f.job === null || f.job.status === "DONE", `${f.key}: no live job`);
      assert.equal(f.game.gameData[SEED_MARK], REVIEW_SEED_TAG);
      assert.ok(f.players.some((p) => p.userId === ctx.member.id));
      assert.equal(f.reviews.length, f.analysis ? f.players.length : 0, `${f.key}: a review per member side`);
      for (const r of f.reviews) assert.ok(ReviewContentV1.safeParse(r.content).success, f.key);
      assert.equal(f.game.ref, reviewFixtureRef(f.key as never, ctx.member.ref));
    }
  });

  it("the archive is mixed: results, time classes, member and bot opponents, analysed and not", () => {
    const results = new Set(all.map((f) => memberSide(f.key).result));
    assert.deepEqual([...results].sort(), ["DRAW", "LOSS", "WIN"]);
    const tcs = new Set(all.map((f) => f.game.timeClass));
    for (const tc of ["BULLET", "BLITZ", "RAPID", "CLASSICAL", "UNTIMED"]) assert.ok(tcs.has(tc as never), tc);
    const opponents = new Set(all.map((f) => memberSide(f.key).opponentName));
    assert.ok(opponents.has("tal_fan_77") && opponents.has("martin_k") && [...opponents].some((o) => o.startsWith("Engine ")));
    assert.ok(all.filter((f) => f.players.length === 2).length >= 10, "member opponents have their own game_players row");
    assert.ok(all.some((f) => memberSide(f.key).momentsCount === 0 && f.game.analysisStatus === "DONE"), "a clean game");
    assert.ok(all.filter((f) => memberSide(f.key).momentsCount > 0).length >= 15);
    // the archive search "tal" finds the tal_fan_77 rows
    assert.ok(all.filter((f) => memberSide(f.key).opponentName.includes("tal")).length >= 5);
  });

  it("GAME and CLEAN carry the design data", () => {
    const g = byKey.get("GAME")!;
    assert.equal(g.game.mode, "ONLINE");
    assert.equal(memberSide("GAME").headline, "Missed Rxf5 · move 19");
    assert.equal(g.game.completedAt.toISOString(), "2026-11-09T18:42:10.000Z");
    const c = byKey.get("CLEAN")!;
    const cw = c.reviews[0]!.content;
    assert.equal(cw.isClean, true);
    assert.equal(cw.bestPly, 30);
    assert.equal(c.game.timeClass, "UNTIMED");
    assert.equal(c.game.endMethod, "CHECKMATE");
  });

  it("LEGEND: Opera position, 2 of 3 matched, 12.Ba4 for 12.O-O-O, drawn by repetition, READY with evals", () => {
    const f = byKey.get("LEGEND")!;
    assert.equal(f.game.startingFen, OPERA_FEN);
    assert.equal(f.game.startPly, 18);
    assert.equal(f.game.chessPositionId, ctx.operaPositionId);
    assert.equal(f.game.mode, "LEGEND_BOT");
    assert.equal(f.game.endMethod, "THREEFOLD");
    assert.ok(replayUci(f.game.startingFen, f.game.moves.split(" ")).final.threefold, "the final position is a threefold repetition");
    assert.equal(memberSide("LEGEND").result, "DRAW");
    assert.equal(f.game.meta.position?.name, "Opera Game, Paris 1858");
    const l = f.legend[0]!;
    assert.equal(l.status, "READY");
    assert.ok(ComparisonFactsV1.safeParse(l.facts).success);
    assert.deepEqual([l.facts.matchedPlies, l.facts.comparedPlies, l.facts.userSan, l.facts.legendSan], [2, 3, "Ba4", "O-O-O"]);
    assert.deepEqual(l.facts.evalAtDivergence, { userWin: 41.2, legendWin: 78.4 });
    assert.equal(f.game.analysisStatus, "NONE");
  });

  it("LEGEND_KT: facts only, the member left the line with 27.Qc3+", () => {
    const f = byKey.get("LEGEND_KT")!;
    assert.equal(f.game.startingFen, KT_FEN);
    const l = f.legend[0]!;
    assert.equal(l.status, "FACTS_READY");
    assert.equal(l.facts.divergenceBy, "user");
    assert.deepEqual([l.facts.userSan, l.facts.legendSan, l.facts.evalAtDivergence], ["Qc3+", "b4+", null]);
  });

  it("UNANALYSED: a member game with no analysis and no job", () => {
    const f = byKey.get("UNANALYSED")!;
    assert.equal(f.game.analysisStatus, "NONE");
    assert.equal(f.game.timeClass, "CLASSICAL");
    assert.ok(f.game.plyCount >= 6);
    assert.deepEqual(f.expect, { analysisStatus: "NONE", job: null, analysis: false, reviews: 0, legend: [] });
  });

  it("the legend fixtures need the content seed's positions", () => {
    assert.throws(() => reviewFixtures({ ...ctx, operaPositionId: null }), /seed:content/);
    assert.throws(() => reviewFixtures({ ...ctx, ktPositionId: null }), /seed:content/);
  });

  it("TERMINAL (the review-terminal persona): FAILED at 30 plies, no retry left", () => {
    const f = terminalFixture(ctx);
    assert.equal(f.game.analysisStatus, "FAILED");
    assert.equal(f.analysis?.gradedPlies, 30);
    assert.deepEqual([f.job?.status, f.job?.attempts, f.job?.maxAttempts], ["FAILED", 4, 4]);
    assert.match(f.job!.lastError!, /^engine_failed: /);
  });

  it("persona writers refuse the shared e2e letters before touching the database", async () => {
    const noDb = {} as never;
    await assert.rejects(writePersonaFixtures(noDb, "e2e-playera+clerk_test@chessbattle.dev", ["GAME"]), /shared e2e user/);
    await assert.rejects(writePersonaFixtures(noDb, "E2E-PLAYERR+clerk_test@chessbattle.dev", ["TERMINAL"]), /shared e2e user/);
  });
});

describe("the smoke seed (plan 12.8)", () => {
  it("smoke-26: a fixed ref on every database, 26 plies, unanalysed", () => {
    assert.equal(SMOKE_GAME_REF, "ce79ed7837da5c852da53f8aa");
    const f = smokeFixture(m(77n, "smoke_p3", 0), null);
    assert.equal(f.game.ref, SMOKE_GAME_REF);
    assert.equal(f.game.plyCount, SMOKE_PLIES);
    assert.equal(f.game.analysisStatus, "NONE");
    assert.equal(f.job, null);
    assert.equal(f.game.mode, "BOT");
  });
});

describe("the perf seed (plan 9.3, 12.7)", () => {
  it("2,000 rows: 1 in 100 SKIPPED, two thirds of the rest DONE", () => {
    const kinds = Array.from({ length: 2000 }, (_, i) => perfKind(i));
    assert.equal(kinds.filter((k) => k === "skipped").length, 20);
    assert.ok(kinds.filter((k) => k === "done").length > 1300);
    assert.ok(kinds.filter((k) => k === "none").length > 600);
  });

  it("rows are coherent: DONE has its analysis and review, SKIPPED is a short game, all bots", () => {
    const member = m(500n, "perf_archive", 1350);
    const rows = perfFixtures(member, 120, 1n);
    for (const f of rows) {
      assert.equal(f.players.length, 1);
      assert.equal(f.game.mode, "BOT");
      if (f.game.analysisStatus === "DONE") assert.ok(f.analysis && f.reviews.length === 1);
      else assert.ok(!f.analysis && f.reviews.length === 0 && f.job === null);
      if (f.game.analysisStatus === "SKIPPED") assert.ok(f.game.plyCount < 6);
    }
    assert.equal(perfFixture(member, 99, null).game.analysisStatus, "SKIPPED");
    // newest first: completedAt falls with i
    assert.ok(rows[0]!.game.completedAt > rows[119]!.game.completedAt);
    const refs = perfReviewRefs(rows);
    assert.equal(refs.length, PERF_REVIEW_SET);
    assert.ok(refs.every((r) => rows.find((f) => f.game.ref === r)!.game.analysisStatus === "DONE"));
  });
});
