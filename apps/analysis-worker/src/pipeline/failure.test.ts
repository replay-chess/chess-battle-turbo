// Failures (phase-03 plan §12.1 `failure.test`, §8.12 "Failure", §7.7 retries): the engine dies twice → the job is
// QUEUED with runAt + 30 s and `analysis:failed` retryable; the 4th attempt → FAILED, retryable false; a Neon fetch
// error → one retry (the statement is idempotent), a second → `internal`; a job lost to the reaper writes nothing; the
// `stall_at_ply` fault stops heart-beating and ends as `worker_stalled`; a SIGTERM in pass 2 releases the job. Each
// failure also reaches PostHog (`analysis_failed`) and Sentry (`worker.job.fail`).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mockGradeInput } from "@repo/chess-analysis/fixtures/labels/design-mock";
import { ANALYSIS_EVENTS } from "@repo/contracts/socket/analysis";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import type { Driver, Row, Statement } from "../db/client";
import { FakeEngine } from "../engine/fake";
import { BACKOFF_SEC } from "../queue/outcome";
import { flush } from "../scheduler/clock";
import { FakeQueue } from "../testing/fake-queue";
import type { MemGameInit } from "../testing/memory-store";
import { harness, T0, TEST_OPENINGS } from "../testing/pipeline-harness";
import { STALL_HOLD_MS } from "./analyze-game";
import { SqlAnalysisStore } from "./sql-store";

const GAME_UCI = mockGradeInput("GAME").replay.uci;
const REF = "cgamereference0000000001";
const W = { color: "w" as const, userId: "11", userRef: "cuserwhite00000000000001", result: "LOSS" as const };
const GAME: MemGameInit = { id: "1", ref: REF, moves: GAME_UCI, members: [W], completedAtMs: T0 };

describe("failure", () => {
  it("the engine dies twice on one position → QUEUED after 30 s, analysis:failed retryable, telemetry", async () => {
    const h = await harness({ fault: { kind: "engine_crash", count: 2 } });
    h.addGame(structuredClone(GAME));
    h.enqueue("1", REF);
    assert.equal(await h.run(), "failed");
    const job = h.queue.jobs[0]!;
    assert.equal(job.status, "QUEUED");
    assert.equal(job.runAtMs, T0 + BACKOFF_SEC[0] * 1000);
    assert.match(job.lastError ?? "", /^engine_failed: /);
    assert.equal(h.store.games.get("1")!.analysisStatus, "FAILED");
    const sent = h.sent("analysis:failed");
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]!.userRefs, [W.userRef]);
    const ev = ANALYSIS_EVENTS["analysis:failed"].parse(sent[0]!.data);
    assert.equal(ev.retryable, true);
    assert.equal(ev.code, "engine_failed");
    assert.equal(ev.retryAt, new Date(T0 + 30_000).toISOString());
    assert.deepEqual(
      h.events.named("analysis_failed").map((e) => e.props),
      [{ code: "engine_failed", attempt: 1, failed_at_ply: 0, retryable: true, app_env: "test" }],
    );
    assert.deepEqual(h.telemetry.named("worker.job.fail")[0]?.attributes, {
      kind: "ANALYZE_GAME",
      code: "engine_failed",
    });
    assert.equal(h.engine.state, "fake", "a fresh engine is left for the next job");
  });

  it("the 4th failed attempt is terminal: FAILED, retryable false, no retry time", async () => {
    const h = await harness({ fault: { kind: "fail_at_ply", ply: 12 } });
    h.addGame(structuredClone(GAME));
    h.enqueue("1", REF, { attempts: 3 });
    assert.equal(await h.run(), "failed");
    const job = h.queue.jobs[0]!;
    assert.equal(job.status, "FAILED");
    const ev = ANALYSIS_EVENTS["analysis:failed"].parse(h.sent("analysis:failed")[0]!.data);
    assert.equal(ev.retryable, false);
    assert.equal(ev.retryAt, null);
    assert.equal(ev.failedAtPly, 10, "graded up to the checkpoint at 10");
    assert.equal(h.events.named("analysis_failed")[0]!.props.retryable, false);
  });

  it("a background job's failure counts in the member's analysis:batch (analysis:failed still goes out)", async () => {
    const h = await harness({ fault: { kind: "fail_at_ply", ply: 4 } });
    h.addGame(structuredClone(GAME));
    h.enqueue("1", REF, { priority: JOB_PRIORITY.BACKLOG, reason: "backfill" });
    assert.equal(await h.run(), "failed");
    await flush();
    assert.equal(h.sent("analysis:failed").length, 1);
    const batch = h.sent("analysis:batch").map((b) => ANALYSIS_EVENTS["analysis:batch"].parse(b.data));
    assert.deepEqual(batch, [{ v: 1, done: 0, failed: 1, queued: 1, refs: [REF] }]);
  });

  it("a job lost to the reaper mid-run writes nothing more", async () => {
    const h = await harness({
      wrapStore: (s) => {
        const checkpoint = s.checkpoint.bind(s);
        s.checkpoint = async (w) => {
          if (w.gradedPlies === 20) {
            // Another worker's reaper took the job while this one was stuck.
            Object.assign(h0().queue.jobs[0]!, { status: "QUEUED", lockedBy: null });
          }
          return checkpoint(w);
        };
        return s;
      },
    });
    const h0 = () => h;
    h.addGame(structuredClone(GAME));
    h.enqueue("1", REF);
    assert.equal(await h.run(), "lost");
    assert.deepEqual(
      h.store.writes.map((w) => (w.kind === "checkpoint" ? w.gradedPlies : w.kind)),
      [10],
      "the checkpoint at 20 rolled back; no final write",
    );
    assert.equal(h.sent("analysis:failed").length, 0);
    assert.equal(h.queue.jobs[0]!.status, "QUEUED");
  });

  it("stall_at_ply stops heart-beating and holds past the reaper's limit, then fails worker_stalled", async () => {
    const h = await harness({ fault: { kind: "stall_at_ply", ply: 20 } });
    h.addGame(structuredClone(GAME));
    h.enqueue("1", REF);
    const result = h.run();
    for (let i = 0; i < 200 && h.clock.nextDue !== T0 + STALL_HOLD_MS; i++) await flush(1);
    assert.equal(h.clock.nextDue, T0 + STALL_HOLD_MS, "holding, with the heartbeat timer gone");
    assert.equal(h.clock.pending, 1);
    await h.clock.advance(STALL_HOLD_MS);
    assert.equal(await result, "failed");
    assert.match(h.queue.jobs[0]!.lastError ?? "", /^worker_stalled: /);
    assert.equal(ANALYSIS_EVENTS["analysis:failed"].parse(h.sent("analysis:failed")[0]!.data).code, "worker_stalled");
  });

  it("SIGTERM during pass 2 checkpoints the whole pass 1 and releases the job", async () => {
    let stop: AbortController | null = null;
    const n = GAME_UCI.length;
    const h = await harness({
      engineFactory: () => {
        const e = new FakeEngine();
        const search = e.search.bind(e);
        e.search = async (req) => {
          const out = await search(req);
          if (e.searches === n + 2) stop?.abort("stop");
          return out;
        };
        return e;
      },
    });
    stop = h.stop;
    h.addGame(structuredClone(GAME));
    h.enqueue("1", REF);
    assert.equal(await h.run(), "released");
    const g = h.store.games.get("1")!;
    assert.equal(g.analysis?.gradedPlies, n, "pass 1 is complete in the checkpoint");
    assert.equal(g.analysis?.completed, false);
    assert.equal(h.queue.jobs[0]!.attempts, 0);
  });
});

// ── Neon fetch errors through the real SQL store ────────────────────────────────────────────────────────────────
/**
 * A driver for SqlAnalysisStore: the job statements go to the FakeQueue, the load and openings statements get canned
 * rows, the analysis writes succeed silently, and `failRoundTrips` makes the next round trips that hold a
 * game_analyses write throw ECONNRESET (a dropped Neon HTTP request).
 */
class PipelineDriver implements Driver {
  failRoundTrips = 0;
  readonly batches: string[][] = [];

  constructor(private readonly queue: FakeQueue) {}

  async run(ss: readonly Statement[], transaction: boolean): Promise<Row[][]> {
    if (ss.some((s) => s.text.includes("INSERT INTO game_analyses")) && this.failRoundTrips > 0) {
      this.failRoundTrips--;
      throw Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
    }
    if (transaction) this.batches.push(ss.map((s) => s.text.trim().split(/\s+/).slice(0, 3).join(" ")));
    const out: Row[][] = [];
    for (const s of ss) out.push(await this.one(s));
    return out;
  }

  private async one(s: Statement): Promise<Row[]> {
    const t = s.text;
    if (t.includes("WITH st AS (")) {
      return [
        {
          id: "1",
          ref: REF,
          status: "COMPLETED",
          mode: "BOT",
          startingFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
          startPly: 0,
          moves: GAME_UCI.join(" "),
          plyCount: GAME_UCI.length,
          completedAtMs: T0,
          ecoCode: null,
          openingName: null,
          members: [{ color: "w", userId: "11", userRef: W.userRef, result: "LOSS" }],
          analysis: null,
          legend: null,
          comparisons: [],
          jobLastError: null,
        },
      ];
    }
    if (t.includes("FROM openings")) return TEST_OPENINGS.map((o) => ({ ...o }));
    if (
      /^(INSERT INTO (game_analyses|player_reviews|legend_comparisons)|UPDATE (games|game_players|users u))/.test(
        t.trim(),
      )
    )
      return [];
    const [rows] = await this.queue.run([s], false);
    return rows ?? [];
  }

  async close(): Promise<void> {}
}

describe("failure: Neon fetch errors (SqlAnalysisStore)", () => {
  async function sqlHarness(failRoundTrips: number) {
    let driver: PipelineDriver | null = null;
    const h = await harness({
      driver: (queue) => (driver = new PipelineDriver(queue)),
      wrapStore: (_memory, db) => new SqlAnalysisStore(db),
    });
    driver!.failRoundTrips = failRoundTrips;
    h.addGame(structuredClone(GAME));
    h.enqueue("1", REF);
    return { h, driver: driver! };
  }

  it("a dropped request is retried once (idempotent statements) and the job completes; the final batch holds 7 statements", async () => {
    const { h, driver } = await sqlHarness(1);
    assert.equal(await h.run(), "done");
    assert.equal(h.db.counters.retries, 1);
    assert.equal(h.queue.jobs[0]!.status, "DONE");
    const final = driver.batches[driver.batches.length - 1]!;
    assert.equal(final.length, 7, "guard, analyses, games, reviews, players, users, done");
    assert.match(final[0]!, /^SELECT 1 \//);
    assert.match(final[final.length - 1]!, /^UPDATE jobs SET/);
    const checkpoints =
      driver.batches.filter((b) => b.some((t) => t.startsWith("INSERT INTO game_analyses"))).length - 1;
    assert.equal(checkpoints, 5, "checkpoints at 10 … 50, each one request");
  });

  it("a second failure of the same request fails the attempt as internal", async () => {
    const { h } = await sqlHarness(2);
    assert.equal(await h.run(), "failed");
    assert.equal(h.db.counters.retries, 1, "retried exactly once");
    assert.match(h.queue.jobs[0]!.lastError ?? "", /^internal: unexpected error \(ECONNRESET\)/);
    assert.equal(h.queue.jobs[0]!.status, "QUEUED");
  });
});
