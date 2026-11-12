// The review DAL's builders (phase-03 plan §12.1 `WEB/lib/data/review.test.ts`): the DTO built from fixture rows parses
// with ReviewDTO in every state; player cards come from game_players (member, bot, external, legend); the ETag is
// stable and equal from the probe row and the full row; a non-player is DataError not_found; an admin reads with
// isYou false. The SQL itself runs in test/api/review.contract.int.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gradeAnalysis } from "@repo/chess-analysis/analysis";
import { fixtureReview, gameAnalysisInput } from "@repo/chess-analysis/fixtures/review-inputs";
import { legendFixture, legendFixtureFacts } from "@repo/chess-analysis/fixtures/legend";
import { ReviewCompleteView, ReviewDTO, ReviewStatusDTO } from "@repo/contracts/http/review";
import { buildReviewContent } from "@repo/db/json";
import { getReview } from "@/lib/services/analysis/read";
import type { ProbeRow, ReviewRow, StatusRow } from "@/lib/services/analysis/review-sql";
import {
  buildCompleteView,
  buildReviewDTO,
  buildStatusDTO,
  endLabelOf,
  opponentKindOf,
  playedAtLabelOf,
  replayMoves,
  reviewEtag,
  statusEtag,
} from "@/lib/services/analysis/review-dto";
import { isNotFound } from "./errors";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const INITIAL = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const input = gameAnalysisInput();
const graded = gradeAnalysis(input);
const content = buildReviewContent(fixtureReview("GAME"));
const REF = "cgame000000000000000000000";
const OPTS = { nowMs: NOW, siteOrigin: "https://dev.example.test" };

function row(overrides: Partial<ReviewRow> = {}): ReviewRow {
  const total = graded.totalPlies;
  return {
    gameId: 10n,
    ref: REF,
    analysisStatus: "DONE",
    chessPositionId: null,
    memberId: 1n,
    color: "w",
    isPlayer: true,
    version: 1,
    gradedPlies: total,
    totalPlies: total,
    failedAtPly: null,
    analysisUpdatedAt: new Date(NOW - 60_000),
    reviewUpdatedAt: new Date(NOW - 50_000),
    jobStatus: "DONE",
    attempts: 1,
    maxAttempts: 4,
    runAt: new Date(NOW - 120_000),
    heartbeatAt: null,
    lastKickAt: null,
    lastError: null,
    shareCode: null,
    shareShowUsername: null,
    shareExpiresAt: null,
    comparisonStatus: null,
    comparisonUpdatedAt: null,
    mode: "ONLINE",
    source: "REPLAY",
    startingFen: INITIAL,
    startPly: 0,
    moves: input.moves.join(" "),
    moveClocksMs: input.moves.map((_, i) => 600_000 - i * 5_000),
    plyCount: total,
    gameStatus: "COMPLETED",
    outcome: "BLACK",
    endMethod: "RESIGNATION",
    completedAt: new Date(NOW - 3_600_000),
    playedAt: new Date(NOW - 3_600_000),
    timeClass: "RAPID",
    ecoCode: "C59",
    openingName: "Two Knights Defense",
    initialTimeSeconds: 600,
    incrementSeconds: 0,
    botElo: null,
    metaPosition: null,
    youName: "knightowl_88",
    ratingBefore: 1184,
    opponentUserId: 2n,
    opponentName: "tal_fan_77",
    opponentRating: 1203,
    myAccuracy: graded.accuracy.w,
    myPhaseAccuracy: [93.2, 74.4, -1],
    momentsCount: content.moments.length,
    oppAccuracy: graded.accuracy.b,
    oppPhaseAccuracy: [92, 88, -1],
    positionRef: null,
    legendMoveNumber: null,
    legendMeta: null,
    whitePlayerName: null,
    blackPlayerName: null,
    whiteLegendName: null,
    blackLegendName: null,
    tournamentName: null,
    eventDate: null,
    legendHasPgn: null,
    queueAhead: null,
    engine: "sf18-test/sf18-v1",
    evals: [...input.evals],
    best: [...input.best],
    judgements: graded.judgements,
    middlegamePly: 24,
    endgamePly: null,
    accuracyWhite: graded.accuracy.w,
    accuracyBlack: graded.accuracy.b,
    countsWhite: graded.counts.w,
    countsBlack: graded.counts.b,
    depthP50: 18,
    content,
    textStatus: "TEMPLATE",
    progress: { v: 1, momentIndex: 1, results: { "32": "FOUND" }, attempts: { "32": 1 }, planChips: {}, bankOptOut: [36] },
    reviewStartedAt: new Date(NOW - 40_000),
    reviewCompletedAt: null,
    legendName: null,
    ...overrides,
  };
}

describe("buildReviewDTO", () => {
  it("done: parses with ReviewDTO; moments, progress and the bank opt-out are the viewer's", () => {
    const dto = ReviewDTO.parse(buildReviewDTO(row(), OPTS));
    assert.equal(dto.status, "done");
    assert.equal(dto.you, "w");
    assert.equal(dto.san.split(" ").length, input.moves.length);
    assert.equal(dto.analysis?.j.length, graded.totalPlies);
    assert.equal(dto.analysis?.evals.length, graded.totalPlies + 1);
    assert.equal(dto.analysis?.accuracy.w, Math.round(graded.accuracy.w!));
    assert.deepEqual(dto.analysis?.phaseAccuracy.w, [93, 74, -1]);
    assert.deepEqual(dto.review?.moments.map((m) => [m.ply, m.moveLabel, m.result, m.inBank]), [
      [32, "17.", "found", true],
      [36, "19.", null, false],
      [40, "21.", null, true],
    ]);
    assert.equal(dto.review?.progress.momentIndex, 1);
    assert.equal(dto.game.tc.label, "Rapid 10+0");
    assert.equal(dto.game.result, "0-1");
    assert.equal(dto.game.endLabel, "0–1 resigned");
    assert.deepEqual(dto.game.opening, { eco: "C59", name: "Two Knights Defense" });
    assert.equal(dto.share, null);
  });

  it("queued without a checkpoint: a skeleton (gradedPlies 0, empty arrays, queue set) that progress can splice into", () => {
    const dto = ReviewDTO.parse(
      buildReviewDTO(
        row({ analysisStatus: "QUEUED", jobStatus: "QUEUED", version: null, gradedPlies: null, totalPlies: null, evals: null, best: null, judgements: null, queueAhead: 2, content: null }),
        OPTS,
      ),
    );
    assert.equal(dto.status, "queued");
    assert.deepEqual(
      { g: dto.analysis?.gradedPlies, t: dto.analysis?.totalPlies, e: dto.analysis?.evals, j: dto.analysis?.j, b: dto.analysis?.best },
      { g: 0, t: graded.totalPlies, e: [], j: "", b: "" },
    );
    assert.equal(dto.analysis?.queue?.position, 2);
    assert.ok((dto.analysis?.queue?.etaSec ?? 0) > 50);
    assert.equal(dto.review, null);
  });

  it("running: the graded prefix only; counts computed from the judgements; no review yet", () => {
    const dto = ReviewDTO.parse(
      buildReviewDTO(row({ analysisStatus: "QUEUED", jobStatus: "RUNNING", heartbeatAt: new Date(NOW - 5_000), gradedPlies: 20, content: null }), OPTS),
    );
    assert.equal(dto.status, "running");
    assert.equal(dto.analysis?.j.length, 20);
    assert.equal(dto.analysis?.best.split(" ").length, 20);
    assert.equal(dto.analysis?.evals.length, 21);
    assert.equal(
      dto.analysis!.counts.w.reduce((a, b) => a + b, 0) + dto.analysis!.counts.b.reduce((a, b) => a + b, 0),
      graded.totalPlies,
    );
    assert.deepEqual(dto.analysis?.accuracy, { w: null, b: null });
  });

  it("none and skipped: no analysis object; failed keeps the skeleton with the failure", () => {
    for (const status of ["NONE", "SKIPPED"] as const) {
      const dto = ReviewDTO.parse(buildReviewDTO(row({ analysisStatus: status, jobStatus: null, content: null }), OPTS));
      assert.equal(dto.analysis, null);
      assert.equal(dto.review, null);
    }
    const failed = ReviewDTO.parse(
      buildReviewDTO(row({ analysisStatus: "FAILED", jobStatus: "FAILED", attempts: 4, gradedPlies: 20, lastError: "engine_failed: x", content: null }), OPTS),
    );
    assert.deepEqual(failed.analysis?.failure, { failedAtPly: 20, retryable: false, retryAt: null, code: "engine_failed" });
  });

  it("player cards: you from users.name + ratingBefore; the opponent from the game_players snapshot", () => {
    const black = ReviewDTO.parse(buildReviewDTO(row({ color: "b", youName: "me", opponentName: "them" }), OPTS));
    assert.deepEqual(black.players.b, { name: "me", rating: 1184, initials: "ME", kind: "member", isYou: true });
    assert.equal(black.players.w.name, "them");
    const bot = ReviewDTO.parse(buildReviewDTO(row({ mode: "BOT", opponentUserId: null, opponentName: "Engine 1400", opponentRating: 1400 }), OPTS));
    assert.deepEqual(bot.players.b, { name: "Engine 1400", rating: 1400, initials: "EN", kind: "bot", isYou: false });
    assert.equal(opponentKindOf({ opponentUserId: null, mode: "IMPORTED", source: "LICHESS", opponentIsLegend: false }), "external");
    assert.equal(opponentKindOf({ opponentUserId: null, mode: "FRIEND", source: "REPLAY", opponentIsLegend: true }), "legend");
    assert.equal(opponentKindOf({ opponentUserId: 5n, mode: "BOT", source: "REPLAY", opponentIsLegend: true }), "member");
  });

  it("admin read: the member row stands in for you, isYou false", () => {
    const dto = ReviewDTO.parse(buildReviewDTO(row({ isPlayer: false }), OPTS));
    assert.equal(dto.players.w.isYou, false);
    assert.equal(dto.players.w.name, "knightowl_88");
  });

  it("the viewer's live share becomes an absolute /r/<code> URL", () => {
    const dto = ReviewDTO.parse(
      buildReviewDTO(row({ shareCode: "8kq2xh4m", shareShowUsername: false, shareExpiresAt: new Date(NOW + 86_400_000) }), OPTS),
    );
    assert.deepEqual(dto.share, {
      code: "8kq2xh4m",
      url: "https://dev.example.test/r/8kq2xh4m",
      expiresAt: new Date(NOW + 86_400_000).toISOString(),
      showUsername: false,
    });
  });

  it("a legend game names the legend from the facts row, else from the position's side name", () => {
    const fromFacts = ReviewDTO.parse(buildReviewDTO(row({ chessPositionId: 3n, legendName: "Morphy" }), OPTS));
    assert.deepEqual(fromFacts.game.legend, { name: "Morphy", compareHref: `/review/${REF}/legend` });
    const fromPosition = ReviewDTO.parse(
      buildReviewDTO(row({ chessPositionId: 3n, whitePlayerName: "Paul Morphy", legendHasPgn: true }), OPTS),
    );
    assert.equal(fromPosition.game.legend?.name, "Morphy");
    const noPgn = ReviewDTO.parse(buildReviewDTO(row({ chessPositionId: 3n, whitePlayerName: "Paul Morphy", legendHasPgn: false }), OPTS));
    assert.equal(noPgn.game.legend, null);
  });

  it("a legacy move list with an illegal move is cut there (san and moves stay aligned)", () => {
    const dto = ReviewDTO.parse(buildReviewDTO(row({ moves: "e2e4 e7e5 e1e8 g1f3", analysisStatus: "NONE", jobStatus: null }), OPTS));
    assert.equal(dto.moves, "e2e4 e7e5");
    assert.equal(dto.san, "e4 e5");
  });
});

describe("labels", () => {
  it("end labels and dates", () => {
    assert.equal(endLabelOf("WHITE", "CHECKMATE"), "1–0 checkmate");
    assert.equal(endLabelOf("DRAW", "AGREEMENT"), "½–½ agreed");
    assert.equal(endLabelOf("NONE", "ABORTED"), "Aborted");
    assert.equal(playedAtLabelOf(new Date("2026-11-09T18:00:00Z"), NOW), "Nov 9");
    assert.equal(playedAtLabelOf(new Date("2025-11-09T18:00:00Z"), NOW), "Nov 9, 2025");
  });
});

describe("ETags", () => {
  const probeOf = (r: ReviewRow): ProbeRow => {
    const {
      gameId, ref, analysisStatus, chessPositionId, memberId, color, isPlayer, version, gradedPlies, totalPlies, failedAtPly,
      analysisUpdatedAt, reviewUpdatedAt, jobStatus, attempts, maxAttempts, runAt, heartbeatAt, lastKickAt, lastError,
      shareCode, shareShowUsername, shareExpiresAt, comparisonStatus, comparisonUpdatedAt,
    } = r;
    return {
      gameId, ref, analysisStatus, chessPositionId, memberId, color, isPlayer, version, gradedPlies, totalPlies, failedAtPly,
      analysisUpdatedAt, reviewUpdatedAt, jobStatus, attempts, maxAttempts, runAt, heartbeatAt, lastKickAt, lastError,
      shareCode, shareShowUsername, shareExpiresAt, comparisonStatus, comparisonUpdatedAt,
    };
  };

  it("the probe row and the full row give the same tag (the 304 path and the 200 path agree)", () => {
    assert.equal(reviewEtag(probeOf(row()), NOW), reviewEtag(row(), NOW));
    assert.equal(reviewEtag(row(), NOW), reviewEtag(row(), NOW + 60_000), "stable over time for a done review");
  });

  it("changes with graded plies, the status, the review row, the share and the viewer side", () => {
    const base = reviewEtag(row(), NOW);
    const changed = [
      row({ gradedPlies: 50 }),
      row({ analysisStatus: "QUEUED", jobStatus: "QUEUED" }),
      row({ reviewUpdatedAt: new Date(NOW - 1_000) }),
      row({ shareCode: "8kq2xh4m", shareShowUsername: true }),
      row({ isPlayer: false }),
      row({ version: 2 }),
    ].map((r) => reviewEtag(r, NOW));
    for (const tag of changed) assert.notEqual(tag, base);
    assert.notEqual(
      reviewEtag(row({ shareCode: "8kq2xh4m", shareShowUsername: true }), NOW),
      reviewEtag(row({ shareCode: "8kq2xh4m", shareShowUsername: false }), NOW),
    );
  });

  it("a RUNNING job that stalls changes the tag without any write (the stall rule is time-based)", () => {
    const running = row({ analysisStatus: "QUEUED", jobStatus: "RUNNING", heartbeatAt: new Date(NOW - 60_000) });
    assert.notEqual(reviewEtag(running, NOW), reviewEtag(running, NOW + 60_000));
  });

  it("A2's tag follows the comparison state", () => {
    const a = statusEtag(probeOf(row()), NOW);
    const b = statusEtag(probeOf(row({ comparisonStatus: "FACTS_READY", comparisonUpdatedAt: new Date(NOW) })), NOW);
    const c = statusEtag(probeOf(row({ comparisonStatus: "READY", comparisonUpdatedAt: new Date(NOW + 1) })), NOW);
    assert.equal(new Set([a, b, c]).size, 3);
  });
});

describe("buildStatusDTO (A2)", () => {
  const status = (over: Partial<StatusRow> = {}): StatusRow => ({
    ...row(),
    isClean: false,
    coachLine: content.coachLine?.t ?? null,
    comparisonFacts: null,
    legendPgn: null,
    ...over,
  });

  it("done: the review summary; queued: the ETA; failed: the failure fields", () => {
    const done = ReviewStatusDTO.parse(buildStatusDTO(status(), { nowMs: NOW, comparison: null }));
    assert.deepEqual(done.review, {
      ready: true,
      accuracy: Math.round(graded.accuracy.w!),
      momentsCount: 3,
      isClean: false,
      coachLine: content.coachLine?.t ?? null,
    });
    assert.equal(done.analysis.etaSec, null);
    const queued = ReviewStatusDTO.parse(
      buildStatusDTO(status({ analysisStatus: "QUEUED", jobStatus: "QUEUED", gradedPlies: 0, queueAhead: 1 }), { nowMs: NOW, comparison: null }),
    );
    assert.equal(queued.analysis.status, "queued");
    assert.ok((queued.analysis.etaSec ?? 0) > 25);
    assert.deepEqual(queued.review, { ready: false, accuracy: null, momentsCount: 0, isClean: false, coachLine: null });
  });

  it("a legend game carries the LegendSummaryDTO from the facts", () => {
    const f = legendFixture("opera");
    const dto = ReviewStatusDTO.parse(
      buildStatusDTO(status({ startingFen: f.startFen, outcome: "DRAW" }), {
        nowMs: NOW,
        comparison: { status: "FACTS_READY", facts: legendFixtureFacts(f) },
      }),
    );
    assert.equal(dto.comparison?.status, "facts_ready");
    assert.equal(dto.comparison?.outcomeLine, "Morphy won this; you drew.");
    assert.equal(dto.comparison?.compareHref, `/review/${REF}/legend`);
    assert.match(dto.comparison?.replayHref ?? "", /^\/practice\?game=/);
  });
});

describe("buildCompleteView", () => {
  it("parses with ReviewCompleteView; moments carry the position after the move and the result", () => {
    const dto = buildReviewDTO(row({ reviewCompletedAt: new Date(NOW) }), OPTS);
    const view = ReviewCompleteView.parse(buildCompleteView(dto, { bestThisMonth: true, shareEnabled: true }));
    assert.equal(view.moments.length, 3);
    const fens = replayMoves(INITIAL, dto.moves).fens;
    assert.equal(view.moments[0]!.fenAfter, fens[33]);
    assert.equal(view.found, 1);
    assert.equal(view.reviewed, 1);
    assert.equal(view.partial, false);
    assert.equal(view.header.eyebrow, "Review · vs tal_fan_77 · 0–1");
    assert.equal(view.shareEnabled, true);
    const direct = ReviewCompleteView.parse(buildCompleteView(buildReviewDTO(row(), OPTS), { bestThisMonth: false, shareEnabled: false }));
    assert.equal(direct.partial, true, "a direct visit before Finish Review is partial");
  });

  // regression: no-moments-best-move (FIX-2, review round 2)
  it("a game with no moments (not clean) carries its best decision as the one standout", () => {
    const dto = buildReviewDTO(row(), OPTS);
    const noMoments = { ...dto, review: { ...dto.review!, moments: [], isClean: false } };
    const view = ReviewCompleteView.parse(buildCompleteView(noMoments, { bestThisMonth: false, shareEnabled: false }));
    assert.equal(view.moments.length, 0);
    assert.equal(view.standouts.length, 1);
    const best = view.standouts[0]!;
    assert.equal(best.ply, dto.review!.bestPly);
    const fens = replayMoves(INITIAL, dto.moves).fens;
    assert.equal(best.fenAfter, fens[best.ply + 1]);
    assert.equal(view.standouts.length, 1);
    const withMoments = ReviewCompleteView.parse(buildCompleteView(dto, { bestThisMonth: false, shareEnabled: false }));
    assert.deepEqual(withMoments.standouts, [], "a game with moments shows its moments instead");
  });
});

describe("getReview (the DAL entry)", () => {
  const fakeDb = (rows: unknown[]) => ({
    $queryRaw: async <T>() => rows as T,
    $executeRaw: async () => 0,
  });

  it("a non-player (no row from the player-checked statement) is DataError not_found", async () => {
    await assert.rejects(getReview(fakeDb([]), { id: 9n, role: "user" }, REF, NOW), (err: unknown) => isNotFound(err));
  });

  it("returns the DTO, its row and the strong tag", async () => {
    const out = await getReview(fakeDb([row()]), { id: 1n, role: "user" }, REF, NOW);
    assert.equal(out.dto.ref, REF);
    assert.equal(out.etag, reviewEtag(row(), NOW));
  });
});
