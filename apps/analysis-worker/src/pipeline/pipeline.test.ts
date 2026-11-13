// The ANALYZE_GAME pipeline (phase-03 plan §12.1 `pipeline.test`, §8.12, P3-D26): FakeEngine + the in-memory store.
// Progress frames only for band ≥ 80 or a watched game, every 2 plies, each splicing into what a client holds; no
// per-game frames for a band-10 job and one `analysis:batch` per 60 s; a checkpoint at 10, 20, …; the checkpoint's
// returned priority switching streaming on mid-job; the final batch (second, readyMs, gamesVersion, the P5
// extension hook, ≤ 10 statements); `analysis:done` personalised per member with the coach line; the SKIPPED path;
// the book and opening name; a legend game's facts and divergence evals; spans and telemetry.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deltaFit,
  encodeJudgements,
  mergePlies,
  NO_SECOND,
  type PliesState,
  type ReviewStatus,
} from "@repo/chess-analysis/codec";
import { regradeAnalysis } from "@repo/chess-analysis/regrade";
import { mockGradeInput } from "@repo/chess-analysis/fixtures/labels/design-mock";
import { legendFixture, legendFixtureMoves } from "@repo/chess-analysis/fixtures/legend";
import { analysisEngine, ENGINE_PROFILE, GRADING_VERSION } from "@repo/chess-analysis/version";
import { nextCheckpointAfter } from "@repo/contracts/http/plain";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { ANALYSIS_EVENTS, type AnalysisProgressEvent } from "@repo/contracts/socket/analysis";
import { parseReviewContent } from "@repo/db/json";
import { stmt } from "../db/client";
import { harness, T0, TEST_OPENINGS } from "../testing/pipeline-harness";
import { buildOpeningIndex } from "./openings";
import type { MemGameInit } from "../testing/memory-store";
import { checkpointSpacing, isCheckpointPly } from "./analyze-game";
import { loadOracleGames, oracleReplay } from "@repo/chess-analysis/fixtures/oracle";

const GAME_UCI = mockGradeInput("GAME").replay.uci;
const N = GAME_UCI.length;
const W = { color: "w" as const, userId: "11", userRef: "cuserwhite00000000000001", result: "LOSS" as const };
const B = { color: "b" as const, userId: "12", userRef: "cuserblack00000000000001", result: "WIN" as const };
const REF = "cgamereference0000000001";

function game(extra: Partial<MemGameInit> = {}): MemGameInit {
  return { id: "1", ref: REF, moves: GAME_UCI, members: [W, B], completedAtMs: T0 - 5_000, ...extra };
}

/** A client that loaded A1 at `snapshot` (null = the queued skeleton) and applies frames in order. */
function client(snapshot: { graded: number; evals: number[]; best: string; j: string } | null, total = N) {
  let state: { status: ReviewStatus; analysis: PliesState | null } = {
    status: snapshot ? "running" : "queued",
    analysis: snapshot
      ? { gradedPlies: snapshot.graded, totalPlies: total, evals: snapshot.evals, best: snapshot.best, j: snapshot.j }
      : { gradedPlies: 0, totalPlies: total, evals: [], best: "", j: "" },
  };
  return {
    apply: (ev: AnalysisProgressEvent) => {
      state = mergePlies(state, ev);
    },
    get: () => state,
  };
}

// regression: checkpoint-budget (FIX-1). Checkpoints were a fixed 10 plies apart, so every game over 70 plies broke
// the §9.1 budget of ≤ 6 checkpoints (≤ 10 statements a game); a 156-ply game wrote 15.
describe("checkpoint spacing (§9.1 budget)", () => {
  it("at most 6 checkpoints for games up to 280 plies, every 10 plies up to 70, never more than 40 apart", () => {
    for (let n = 1; n <= 600; n++) {
      const at = Array.from({ length: n }, (_, g) => g).filter((g) => isCheckpointPly(g, n));
      if (n <= 280) assert.ok(at.length <= 6, `${n} plies: ${at.length} checkpoints`);
      if (n <= 70) assert.deepEqual(at, Array.from({ length: Math.floor((n - 1) / 10) }, (_, k) => (k + 1) * 10));
      assert.ok(checkpointSpacing(n) >= 10 && checkpointSpacing(n) <= 40);
    }
  });

  it("a 156-ply game checkpoints 6 times, and a client that reloads mid-run can still follow it", async () => {
    const long = oracleReplay(loadOracleGames().find((g) => g.id === "5VvNDqqZ")!).uci;
    assert.equal(long.length, 156);
    const h = await harness();
    h.addGame(game({ moves: [...long] }));
    h.enqueue("1", REF);
    assert.equal(await h.run(), "done");
    const at = h.store.writes.flatMap((w) => (w.kind === "checkpoint" ? [w.gradedPlies] : []));
    assert.deepEqual(at, [23, 46, 69, 92, 115, 138]);
    // A client that loads A1 while the worker is at ply 36 (A1 serves the checkpoint at 23), and refetches only when
    // the next checkpoint has been written (the web's rule, nextCheckpointAfter), reaches the end with one refetch per
    // checkpoint instead of one per frame of the 23-ply gap.
    const snapshots = new Map(
      h.store.writes.flatMap((w) =>
        w.kind === "checkpoint"
          ? [
              [w.gradedPlies, { graded: w.gradedPlies, evals: [...w.evals], best: "", j: encodeJudgements(w.judgements) }] as [
                number,
                { graded: number; evals: number[]; best: string; j: string },
              ],
            ]
          : [],
      ),
    );
    const N2 = long.length;
    let c = client(snapshots.get(23)!, N2);
    let refetches = 0;
    let ignoredGaps = 0;
    for (const f of h.sent("analysis:progress").map((x) => x.data as AnalysisProgressEvent)) {
      if (f.gradedPlies <= 36) continue;
      const state = c.get();
      const fit = deltaFit(state, f);
      if (fit === "gap") {
        const next = nextCheckpointAfter(state.analysis!.gradedPlies, N2);
        if (next === null || f.gradedPlies < next) {
          ignoredGaps++;
          continue;
        }
        refetches++;
        const latest = Math.max(...at.filter((x) => x <= f.gradedPlies));
        c = client(snapshots.get(latest)!, N2);
      }
      c.apply(f);
    }
    assert.equal(c.get().analysis?.gradedPlies, N2);
    assert.ok(refetches > 0 && refetches <= at.length, `${refetches} refetches`);
    assert.ok(ignoredGaps > 0, "frames inside the gap are ignored, not refetched");
  });
});

describe("ANALYZE_GAME pipeline (band ≥ 80)", () => {
  it("grades the game: frames, checkpoints, final batch, done events, telemetry", async () => {
    const h = await harness();
    h.addGame(game());
    h.enqueue("1", REF);
    assert.equal(await h.run(), "done");

    // ── checkpoints every 10 plies, before the end ──
    const checkpoints = h.store.writes.filter((w) => w.kind === "checkpoint");
    assert.deepEqual(
      checkpoints.map((c) => (c.kind === "checkpoint" ? c.gradedPlies : -1)),
      [10, 20, 30, 40, 50],
    );
    for (const c of checkpoints) {
      if (c.kind !== "checkpoint") continue;
      assert.equal(c.evals.length, c.gradedPlies + 1);
      assert.equal(c.judgements.length, c.gradedPlies);
    }

    // ── progress frames: valid, ≤ 8 plies, every 2 plies, each starting at or before the last checkpoint ──
    const frames = h.sent("analysis:progress").map((s) => s.data as AnalysisProgressEvent);
    assert.ok(frames.length >= N / 2, `${frames.length} frames`);
    for (const f of frames) ANALYSIS_EVENTS["analysis:progress"].parse(f);
    assert.deepEqual(h.sent("analysis:progress")[0]?.userRefs, [W.userRef, B.userRef]);
    assert.equal(frames[0]!.from, 0);
    const ends = frames.map((f) => f.gradedPlies);
    assert.deepEqual(
      ends,
      [...ends].sort((a, b) => a - b),
      "frames in order",
    );
    assert.equal(ends[ends.length - 1], N);
    for (const f of frames) {
      assert.ok(f.gradedPlies - f.from <= 8);
      const lastCheckpoint = Math.max(
        0,
        Math.floor((f.gradedPlies - 1) / checkpointSpacing(N)) * checkpointSpacing(N),
      );
      assert.ok(f.from <= Math.max(lastCheckpoint, f.gradedPlies - 8), `frame ${f.from}→${f.gradedPlies}`);
    }
    // A client from the queued skeleton ends with every pass-1 judgement; one that loaded the checkpoint at 20
    // splices every later frame.
    const fresh = client(null);
    for (const f of frames) fresh.apply(f);
    assert.equal(fresh.get().analysis?.gradedPlies, N);
    const at20 = checkpoints[1]!;
    if (at20.kind !== "checkpoint") throw new Error("checkpoint expected");
    const late = client({ graded: 20, evals: at20.evals, best: "", j: encodeJudgements(at20.judgements) });
    let applied = 0;
    for (const f of frames.filter((x) => x.gradedPlies > 20)) {
      const before = late.get().analysis?.gradedPlies;
      late.apply(f);
      if (late.get().analysis?.gradedPlies !== before) applied++;
    }
    assert.equal(late.get().analysis?.gradedPlies, N, "no gap for a client holding the checkpoint");
    assert.ok(applied > 0);

    // ── writing, then done (one per member, personalised), games:changed ──
    const order = h.emitter.sent.map((s) => s.event).filter((e) => e !== "analysis:progress");
    const writes = order.filter((e) => e === "analysis:writing").length;
    assert.deepEqual(order, [...Array(writes).fill("analysis:writing"), "analysis:done", "analysis:done", "games:changed"]);
    // Pass 2 reports its progress (regression: dev pass D3, the card sat at 95 % for ~10 s): the start without counts,
    // then `at` 0 of the plan and one frame per deep search, ending at `at` = `of`.
    const steps = h.sent("analysis:writing").map((w) => w.data as { at?: number; of?: number });
    assert.equal(steps[0]!.at, undefined);
    const counted = steps.slice(1);
    assert.ok(counted.length >= 2, `pass 2 progress frames (${JSON.stringify(steps)})`);
    const of = counted[0]!.of!;
    assert.ok(of > 0 && of <= 8);
    assert.deepEqual(counted.map((x) => x.at), Array.from({ length: counted.length }, (_, i) => i));
    assert.ok(counted.every((x) => x.of === of));
    assert.equal(counted.at(-1)!.at, of, "the last frame says every planned search is done");
    const lastFrameAt = h.emitter.sent.map((s) => s.event).lastIndexOf("analysis:progress");
    assert.ok(
      h.emitter.sent.findIndex((s) => s.event === "analysis:writing") > lastFrameAt,
      "writing after the last frame",
    );
    const done = h.sent("analysis:done");
    assert.deepEqual(
      done.map((d) => d.userRefs),
      [[W.userRef], [B.userRef]],
    );
    assert.deepEqual(
      done.map((d) => d.dedupeKey),
      [`done:1:${GRADING_VERSION}:w`, `done:1:${GRADING_VERSION}:b`],
    );
    const g = h.store.games.get("1")!;
    for (const d of done) {
      const data = ANALYSIS_EVENTS["analysis:done"].parse(d.data);
      const side = d.userRefs[0] === W.userRef ? "w" : "b";
      const review = g.reviews.get(side)!.content;
      assert.equal(data.coachLine, review.coachLine?.t ?? null);
      assert.equal(data.momentsCount, review.moments.length);
      assert.equal(data.headline, review.headline);
      assert.equal(data.accuracy, Math.round(g.players.get(side)!.accuracy!));
      assert.equal(data.bank, null);
    }

    // ── the final batch ──
    const fin = h.store.writes.find((w) => w.kind === "finish");
    assert.ok(fin && fin.kind === "finish");
    assert.ok(fin.statements <= 10, `${fin.statements} statements`);
    assert.equal(g.analysisStatus, "DONE");
    const a = g.analysis!;
    assert.equal(a.completed, true);
    assert.equal(a.version, GRADING_VERSION);
    assert.equal(a.engine, analysisEngine("fake"));
    assert.equal(a.nodesPass1, ENGINE_PROFILE.pass1.nodes);
    assert.equal(a.evals.length, N + 1);
    assert.equal(a.second.length, N + 1);
    assert.equal(a.best.length, N + 1);
    assert.equal(a.judgements.length, N);
    assert.ok(
      a.judgements.every((j) => j >= 1 && j <= 12),
      "every ply graded",
    );
    assert.ok(
      a.second.some((s) => s !== NO_SECOND),
      "MultiPV-2 scores stored",
    );
    assert.equal(g.final!.readyMs, 5_000, "readyMs = now − games.completedAt for a live_end job");
    assert.equal(g.gamesVersionBumps, 1);
    assert.deepEqual([...g.reviews.keys()].sort(), ["b", "w"]);
    for (const [, r] of g.reviews) {
      assert.ok(parseReviewContent(r.content), "content parses as ReviewContentV1");
      assert.equal(r.textStatus, "TEMPLATE");
    }
    assert.equal(g.players.get("w")!.counts.length, 13);
    assert.equal(g.players.get("w")!.phaseAccuracy.length, 3);
    assert.equal(h.queue.jobs[0]!.status, "DONE");

    // ── the book and the opening ──
    assert.equal(g.ecoCode, "C59");
    assert.equal(g.openingName, "Italian Game: Two Knights Defense, Polerio Defense, Suhle Defense");
    assert.deepEqual(a.judgements.slice(0, 6), [6, 6, 6, 6, 6, 6], "the first plies are BOOK");
    assert.equal(h.store.openingLoads, 1);

    // ── telemetry ──
    assert.deepEqual(h.events.refused, []);
    const started = h.events.named("analysis_started");
    assert.equal(started.length, 1);
    assert.equal(started[0]!.distinctId, W.userRef);
    assert.equal(started[0]!.props.band, "80+");
    assert.equal(started[0]!.props.resumed_from_ply, 0);
    const ready = h.events.named("analysis_ready")[0]!;
    assert.equal(ready.props.plies, N);
    assert.equal(ready.props.ms_from_game_end, 5_000);
    assert.equal(ready.props.regrade, false);
    assert.ok((ready.props.pass2_positions as number) > 0 && (ready.props.pass2_positions as number) <= 6);
    assert.equal(ready.props.app_env, "test");
    const spans = h.telemetry.spans;
    assert.equal(spans[0]!.name, "job.analyze");
    assert.equal(spans[0]!.transaction, true);
    assert.deepEqual(spans[0]!.attributes, {
      kind: "ANALYZE_GAME",
      attempt: 1,
      priority: 80,
      band: "80+",
      profile: "sf18-v1",
    });
    assert.deepEqual(
      spans.slice(1).map((s) => [s.name, s.parent]),
      [
        ["load", "job.analyze"],
        ["pass1", "job.analyze"],
        ["pass2", "job.analyze"],
        ["classify", "job.analyze"],
        ["text", "job.analyze"],
        ["write", "job.analyze"],
      ],
    );
    assert.equal(h.telemetry.named("worker.review_ready_ms")[0]?.value, 5_000);
    assert.equal(h.telemetry.named("worker.job.duration_ms").length, 3);
    assert.equal(h.telemetry.named("worker.queue.wait_ms").length, 1);
    assert.equal(h.clock.pending, 0, "no timer left behind");
  });

  it("pass 2: at most 6 positions, each overwriting the arrays it searched; regrade = the stored labels", async () => {
    const h = await harness();
    h.addGame(game());
    h.enqueue("1", REF);
    await h.run();
    const a = h.store.games.get("1")!.analysis!;
    const lines = a.lines ?? {};
    const deep = Object.keys(lines).length;
    assert.ok(deep > 0, "pass-2 lines stored");
    const fake = h.engines[0]!;
    // Pass 1 searches every non-terminal position once; pass 2 adds at most 6.
    assert.ok(fake.searches > N && fake.searches <= N + 1 + 6, `${fake.searches} searches`);
    const index = buildOpeningIndex(TEST_OPENINGS);
    const regraded = regradeAnalysis({
      stored: a,
      game: { startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", startPly: 0, moves: GAME_UCI },
      members: [
        { side: "w", result: "loss" },
        { side: "b", result: "win" },
      ],
      isBook: (epd) => index.book.has(epd),
    });
    assert.deepEqual(regraded.changedPlies, [], "a regrade of the stored arrays gives the stored labels");
    const g = h.store.games.get("1")!;
    assert.deepEqual(regraded.reviews.w, g.reviews.get("w")!.content);
  });

  it("a P5 final-batch extension rides in the same batch, after the analysis and before DONE", async () => {
    const seen: string[] = [];
    const h = await harness({
      extensions: [
        {
          id: "p5-test",
          statements: (ctx) => {
            seen.push(`${ctx.gameRef}:${ctx.memberSides.join("")}:${ctx.regrade}`);
            return [stmt("SELECT 1 AS p5")];
          },
        },
      ],
    });
    h.addGame(game());
    h.enqueue("1", REF);
    await h.run();
    assert.deepEqual(seen, [`${REF}:wb:false`]);
    const fin = h.store.writes.find((w) => w.kind === "finish");
    assert.ok(fin && fin.kind === "finish" && fin.extensions === 1 && fin.statements === 8);
  });
});

describe("ANALYZE_GAME pipeline: the engine-free regrade path (§8.14)", () => {
  it("a completed analysis of the same profile with an older GRADING_VERSION is re-graded without the engine", async () => {
    const h = await harness();
    h.addGame(game());
    h.enqueue("1", REF);
    await h.run();
    const g = h.store.games.get("1")!;
    const before = structuredClone(g.analysis!);
    const reviewBefore = structuredClone(g.reviews.get("w")!.content);
    // An analysis written by the previous classifier: same arrays, older version, its judgements scrambled.
    g.analysis = { ...g.analysis!, version: GRADING_VERSION - 1, judgements: g.analysis!.judgements.map(() => 9) };
    g.reviews.clear();
    g.analysisStatus = "QUEUED";
    const searches = h.engines[0]!.searches;
    h.emitter.sent.length = 0;
    h.queue.jobs[0]!.status = "DONE";
    h.enqueue("1", REF, { priority: JOB_PRIORITY.HOUSEKEEPING, reason: "regrade", dedupeKey: "analyze:1:regrade" });
    assert.equal(await h.run(), "done");
    assert.equal(h.engines[0]!.searches, searches, "no search");
    const after = h.store.games.get("1")!;
    assert.equal(after.analysis!.version, GRADING_VERSION);
    assert.deepEqual(after.analysis!.judgements, before.judgements, "the current classifier's labels again");
    assert.deepEqual(after.analysis!.evals, before.evals);
    assert.deepEqual(after.reviews.get("w")!.content, reviewBefore);
    assert.equal(after.final!.readyMs, null, "regrades are not measured");
    assert.equal(after.analysisStatus, "DONE");
    const job = h.queue.jobs[1]!;
    assert.equal(job.status, "DONE");
    assert.equal((job.result as { regrade: boolean }).regrade, true);
    assert.equal(h.events.named("analysis_ready").at(-1)!.props.regrade, true);
    assert.equal(h.sent("analysis:progress").length, 0, "a HOUSEKEEPING regrade streams nothing per game");
    assert.equal(h.sent("analysis:batch").length, 2);
    const spans = h.telemetry.spans.slice(-5).map((sp) => sp.name);
    assert.deepEqual(spans, ["job.analyze", "load", "classify", "text", "write"]);
  });
});

describe("ANALYZE_GAME pipeline: bands (P3-D26)", () => {
  it("a BACKLOG job sends no per-game frames, and one analysis:batch per member per 60 s", async () => {
    const h = await harness();
    h.addGame(game());
    h.addGame(game({ id: "2", ref: "cgamereference0000000002" }));
    h.addGame(game({ id: "3", ref: "cgamereference0000000003" }));
    h.enqueue("1", REF, { priority: JOB_PRIORITY.BACKLOG, reason: "backfill" });
    h.enqueue("2", "cgamereference0000000002", { priority: JOB_PRIORITY.BACKLOG, reason: "backfill" });
    h.enqueue("3", "cgamereference0000000003", { priority: JOB_PRIORITY.BACKLOG, reason: "backfill" });
    assert.equal(await h.run(), "done");
    for (const e of ["analysis:progress", "analysis:writing", "analysis:done", "games:changed"]) {
      assert.equal(h.sent(e).length, 0, `no ${e}`);
    }
    let batches = h.sent("analysis:batch");
    assert.equal(batches.length, 2, "one per member");
    assert.deepEqual(
      batches.map((b) => b.userRefs),
      [[W.userRef], [B.userRef]],
    );
    assert.deepEqual(ANALYSIS_EVENTS["analysis:batch"].parse(batches[0]!.data), {
      v: 1,
      done: 1,
      failed: 0,
      queued: 2,
      refs: [REF],
    });
    assert.equal(h.store.games.get("1")!.final!.readyMs, null, "backfills are not measured");

    // The second game finishes inside the member's 60 s window: nothing yet, then the drain end arms one timer.
    await h.run();
    assert.equal(h.sent("analysis:batch").length, 2);
    await h.batch.flushAtDrainEnd();
    assert.equal(h.sent("analysis:batch").length, 2, "still inside the window");
    assert.equal(h.clock.pending, 1, "one timer for the window end");
    await h.run();
    await h.clock.advance(60_000);
    batches = h.sent("analysis:batch");
    assert.equal(batches.length, 4);
    assert.deepEqual(ANALYSIS_EVENTS["analysis:batch"].parse(batches[2]!.data), {
      v: 1,
      done: 2,
      failed: 0,
      queued: 0,
      refs: ["cgamereference0000000003", "cgamereference0000000002"],
    });
    assert.equal(h.clock.pending, 0);
  });

  it("a watched BACKLOG game streams like band 80", async () => {
    const h = await harness({ watched: [REF] });
    h.addGame(game());
    h.enqueue("1", REF, { priority: JOB_PRIORITY.BACKLOG, reason: "backfill" });
    await h.run();
    assert.ok(h.sent("analysis:progress").length > 0);
    assert.equal(h.sent("analysis:done").length, 2);
    assert.equal(h.sent("analysis:batch").length, 0);
  });

  it("the checkpoint's returned priority switches streaming on mid-job (an A3 raised it)", async () => {
    const h = await harness({
      wrapStore: (s) => {
        const checkpoint = s.checkpoint.bind(s);
        s.checkpoint = async (w) => {
          if (w.gradedPlies === 20) h0().queue.jobs[0]!.priority = JOB_PRIORITY.USER_OPENED;
          return checkpoint(w);
        };
        return s;
      },
    });
    const h0 = () => h;
    h.addGame(game());
    h.enqueue("1", REF, { priority: JOB_PRIORITY.BACKLOG, reason: "backfill" });
    await h.run();
    const frames = h.sent("analysis:progress").map((s) => s.data as AnalysisProgressEvent);
    assert.ok(frames.length > 0);
    assert.ok(frames[0]!.gradedPlies > 20, "nothing streamed before the raise");
    assert.ok(frames[0]!.from <= 20, "the first frame splices onto the checkpoint at 20");
    assert.equal(h.sent("analysis:done").length, 2);
    assert.equal(h.sent("analysis:batch").length, 0);
  });
});

describe("ANALYZE_GAME pipeline: skips and legend games", () => {
  it("a 4-ply game is SKIPPED: no engine, analysis:done with nothing to show", async () => {
    const h = await harness();
    h.addGame(game({ moves: GAME_UCI.slice(0, 4) }));
    h.enqueue("1", REF);
    assert.equal(await h.run(), "done");
    const g = h.store.games.get("1")!;
    assert.equal(g.analysisStatus, "SKIPPED");
    assert.equal(g.gamesVersionBumps, 1);
    assert.deepEqual(h.store.writes, [{ kind: "skip", gameId: "1", reason: "too_short" }]);
    assert.equal(h.engines[0]!.searches, 0);
    const done = h.sent("analysis:done").map((d) => ANALYSIS_EVENTS["analysis:done"].parse(d.data));
    assert.equal(done.length, 2);
    assert.deepEqual(
      { ...done[0]!, gameRef: "" },
      {
        v: 1,
        gameRef: "",
        analysisVersion: GRADING_VERSION,
        accuracy: null,
        momentsCount: 0,
        headline: null,
        coachLine: null,
        isClean: false,
        bank: null,
      },
    );
    assert.deepEqual(h.queue.jobs[0]!.result, { skipped: "too_short" });
  });

  it("an aborted game is SKIPPED", async () => {
    const h = await harness();
    h.addGame(game({ status: "ABORTED" }));
    h.enqueue("1", REF);
    await h.run();
    assert.equal(h.store.games.get("1")!.analysisStatus, "SKIPPED");
  });

  it("a legend game: facts inserted at the first checkpoint, divergence evals → READY, compare:ready, legend texts", async () => {
    const f = legendFixture("opera");
    const moves = legendFixtureMoves(f);
    const h = await harness();
    h.addGame({
      id: "7",
      ref: "cgamereference0000000007",
      moves,
      startingFen: f.startFen,
      startPly: 18,
      members: [{ color: "w", userId: "11", userRef: W.userRef, result: "DRAW" }],
      completedAtMs: T0 - 1_000,
      legend: {
        chessPositionId: "55",
        pgn: f.legendPgn,
        gameMetadata: null,
        moveNumber: 10,
        whiteLegendName: null,
        blackLegendName: null,
        whitePlayerName: "Paul Morphy",
        blackPlayerName: "Duke Karl / Count Isouard",
        year: 1858,
      },
    });
    h.enqueue("7", "cgamereference0000000007", { reason: "bot_end" });
    assert.equal(await h.run(), "done");
    const g = h.store.games.get("7")!;
    const row = g.comparisons.get("11")!;
    assert.equal(row.status, "READY");
    const facts = row.facts as {
      historicalName: string;
      divergencePly: number;
      matchedPlies: number;
      evalAtDivergence: { userWin: number; legendWin: number };
    };
    assert.equal(facts.historicalName, "Morphy");
    assert.equal(facts.divergencePly, 4);
    assert.equal(facts.matchedPlies, 2);
    assert.ok(facts.evalAtDivergence.userWin >= 0 && facts.evalAtDivergence.userWin <= 100);
    assert.equal(Math.round(facts.evalAtDivergence.legendWin * 10), facts.evalAtDivergence.legendWin * 10, "1 decimal");
    const cp = h.store.writes.find((w) => w.kind === "checkpoint");
    assert.ok(
      cp && cp.kind === "checkpoint" && cp.gradedPlies === 10,
      "the facts row went in with the first checkpoint",
    );
    assert.deepEqual(
      h.sent("compare:ready").map((s) => s.data),
      [{ v: 1, gameRef: "cgamereference0000000007", status: "ready" }],
    );
    assert.equal(g.reviews.get("w")!.content.headline !== null, true);
    assert.equal(g.final!.readyMs, 1_000);
  });
});
