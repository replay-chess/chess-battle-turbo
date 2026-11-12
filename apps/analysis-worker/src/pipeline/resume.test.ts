// Resume (phase-03 plan §12.1 `resume.test`, §8.12 step 3, owner test T11): a crash at ply 23 → the re-run starts at
// the checkpoint at 20 → the final arrays and reviews are byte-identical to an uninterrupted run (cache off, the
// deterministic FakeEngine). Also SIGTERM: the progress since the last checkpoint is checkpointed, the job is released
// without counting the attempt, and the next run continues from exactly there.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mockGradeInput } from "@repo/chess-analysis/fixtures/labels/design-mock";
import type { AnalysisProgressEvent } from "@repo/contracts/socket/analysis";
import { FakeEngine } from "../engine/fake";
import { harness, T0, type Harness } from "../testing/pipeline-harness";
import type { MemGameInit } from "../testing/memory-store";
import { BACKOFF_SEC } from "../queue/outcome";

const GAME_UCI = mockGradeInput("GAME").replay.uci;
const N = GAME_UCI.length;
const REF = "cgamereference0000000001";
const GAME: MemGameInit = {
  id: "1",
  ref: REF,
  moves: GAME_UCI,
  members: [{ color: "w", userId: "11", userRef: "cuserwhite00000000000001", result: "LOSS" }],
  completedAtMs: T0,
};

async function uninterrupted() {
  const h = await harness();
  h.addGame(structuredClone(GAME));
  h.enqueue("1", REF);
  assert.equal(await h.run(), "done");
  return h.store.games.get("1")!;
}

function finalOf(h: Harness) {
  const g = h.store.games.get("1")!;
  return { analysis: g.analysis, reviews: Object.fromEntries(g.reviews), players: Object.fromEntries(g.players) };
}

describe("resume", () => {
  it("a crash at ply 23 resumes at 20 and ends byte-identical to an uninterrupted run", async () => {
    const reference = await uninterrupted();

    const h = await harness({ fault: { kind: "fail_at_ply", ply: 23 } });
    h.addGame(structuredClone(GAME));
    h.enqueue("1", REF);
    assert.equal(await h.run(), "failed");
    const job = h.queue.jobs[0]!;
    assert.equal(job.status, "QUEUED");
    assert.equal(job.runAtMs, T0 + BACKOFF_SEC[0] * 1000);
    const g = h.store.games.get("1")!;
    assert.equal(g.analysisStatus, "FAILED");
    assert.equal(g.analysis?.gradedPlies, 20, "the checkpoint at 20 survived");
    assert.equal(g.failedAtPly, 20);
    const failed = h.sent("analysis:failed")[0]!.data as { failedAtPly: number; retryable: boolean; code: string };
    assert.deepEqual([failed.failedAtPly, failed.retryable, failed.code], [20, true, "engine_failed"]);

    await h.clock.advance(BACKOFF_SEC[0] * 1000);
    const searchesBefore = h.engines.reduce((n, e) => n + e.searches, 0);
    h.emitter.sent.length = 0;
    assert.equal(await h.run(), "done");
    const frames = h.sent("analysis:progress").map((s) => s.data as AnalysisProgressEvent);
    assert.deepEqual([frames[0]!.from, frames[0]!.gradedPlies], [20, 20], "the first frame is the resume point");
    assert.equal(frames[1]!.from, 20);
    const searched = h.engines.reduce((n, e) => n + e.searches, 0) - searchesBefore;
    assert.ok(searched <= N - 20 + 6, `the re-run searched ${searched} positions (pass 1 from 21 + pass 2)`);
    const started = h.events.named("analysis_started");
    assert.deepEqual(
      started.map((e) => [e.props.attempt, e.props.resumed_from_ply]),
      [
        [1, 0],
        [2, 20],
      ],
    );
    assert.equal(h.events.named("analysis_retry_succeeded")[0]?.props.code, "engine_failed");

    assert.deepEqual(finalOf(h).analysis, reference.analysis);
    assert.deepEqual(finalOf(h).reviews, Object.fromEntries(reference.reviews));
    assert.deepEqual(finalOf(h).players, Object.fromEntries(reference.players));
    assert.equal(h.store.games.get("1")!.analysisStatus, "DONE");
  });

  it("SIGTERM checkpoints the progress, releases the job without counting the attempt, and the next run continues", async () => {
    const reference = await uninterrupted();
    // SIGTERM arrives while position 13 is searched (after the checkpoint at 10).
    let stop: AbortController | null = null;
    const h = await harness({
      engineFactory: () => {
        const e = new FakeEngine();
        const search = e.search.bind(e);
        e.search = async (req) => {
          const out = await search(req);
          if (e.searches === 14) stop?.abort("stop");
          return out;
        };
        return e;
      },
    });
    stop = h.stop;
    h.addGame(structuredClone(GAME));
    h.enqueue("1", REF);
    assert.equal(await h.run(), "released");
    const job = h.queue.jobs[0]!;
    assert.equal(job.status, "QUEUED");
    assert.equal(job.attempts, 0, "the attempt is not counted");
    const g = h.store.games.get("1")!;
    const graded = g.analysis!.gradedPlies;
    assert.equal(graded, 13, "checkpointed at 13 on stop");
    assert.equal(g.analysis!.evals.length, graded + 1);

    // A fresh worker (the stop signal is gone) continues from there.
    const h2 = await harness();
    h2.store.games.set("1", g);
    h2.queue.jobs.push({ ...job });
    h2.store.games.get("1")!.analysisStatus = "QUEUED";
    assert.equal(await h2.run(), "done");
    const first = h2.sent("analysis:progress")[0]!.data as AnalysisProgressEvent;
    assert.equal(first.from, graded);
    assert.deepEqual(h2.store.games.get("1")!.analysis, reference.analysis);
  });

  // regression: resume-determinism — with the real engine a resumed run graded 14–24 % of the plies differently from an
  // uninterrupted one: one `ucinewgame` per run left the transposition table warm from plies 0–19 in the reference run
  // and cold at the resume point. This engine is history-dependent the way a warm hash is (its scores drift with the
  // searches since the last `ucinewgame`), so only a clear before every search makes the two runs agree.
  it("regression: resume-determinism: a history-dependent engine grades a resumed run exactly like an uninterrupted one", async () => {
    const warmEngine = () => {
      const e = new FakeEngine();
      const search = e.search.bind(e);
      const newGame = e.newGame.bind(e);
      let sinceClear = 0;
      e.newGame = async () => {
        sinceClear = 0;
        await newGame();
      };
      e.search = async (req) => {
        const out = await search(req);
        const drift = (sinceClear++ % 9) * 37;
        return { ...out, lines: out.lines.map((l) => ("cp" in l.score ? { ...l, score: { cp: l.score.cp + drift } } : l)) };
      };
      return e;
    };
    const ref = await harness({ engineFactory: warmEngine });
    ref.addGame(structuredClone(GAME));
    ref.enqueue("1", REF);
    assert.equal(await ref.run(), "done");
    const reference = ref.store.games.get("1")!;

    const h = await harness({ engineFactory: warmEngine, fault: { kind: "fail_at_ply", ply: 23 } });
    h.addGame(structuredClone(GAME));
    h.enqueue("1", REF);
    assert.equal(await h.run(), "failed");
    await h.clock.advance(BACKOFF_SEC[0] * 1000);
    assert.equal(await h.run(), "done");
    assert.deepEqual(finalOf(h).analysis, reference.analysis);
    assert.deepEqual(finalOf(h).reviews, Object.fromEntries(reference.reviews));
  });
});
