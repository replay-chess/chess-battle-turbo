// LEGEND_COMPARE (phase-03 plan §7.7, task C6): the two divergence searches at the pass-2 budget → READY with
// `evalAtDivergence` + `compare:ready`; a facts row without a divergence becomes READY with no search; an already
// READY row is only confirmed; after the last attempt the row is FAILED and the member hears `compare:ready failed`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { legendFixture, legendFixtureFacts, legendFixtureMoves } from "@repo/chess-analysis/fixtures/legend";
import { ENGINE_PROFILE } from "@repo/chess-analysis/version";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { harness, T0 } from "../testing/pipeline-harness";

const USER = { color: "w" as const, userId: "11", userRef: "cuserwhite00000000000001", result: "DRAW" as const };
const REF = "cgamereference0000000007";

async function setup(
  name: string,
  opts: { status?: "FACTS_READY" | "READY"; attempts?: number; engineFails?: boolean } = {},
) {
  const f = legendFixture(name);
  const h = await harness(opts.engineFails ? { fault: { kind: "engine_crash", count: 2 } } : {});
  h.addGame({
    id: "7",
    ref: REF,
    moves: legendFixtureMoves(f),
    startingFen: f.startFen,
    members: [{ ...USER, color: f.member }],
    completedAtMs: T0,
    analysisStatus: "DONE",
    comparisons: [{ userId: "11", status: opts.status ?? "FACTS_READY", facts: legendFixtureFacts(f) }],
  });
  h.queue.add({
    kind: "LEGEND_COMPARE",
    priority: JOB_PRIORITY.USER_OPENED,
    dedupeKey: "legend:7:11",
    maxAttempts: 3,
    attempts: opts.attempts ?? 0,
    payload: { v: 1, gameId: "7", userId: "11", gameRef: REF },
  });
  return h;
}

describe("LEGEND_COMPARE", () => {
  it("searches the two divergence positions at the pass-2 budget and makes the row READY", async () => {
    const h = await setup("opera");
    const nodes: number[] = [];
    const search = h.engines[0]!.search.bind(h.engines[0]!);
    h.engines[0]!.search = async (req) => {
      nodes.push(req.nodes, req.multipv);
      return search(req);
    };
    assert.equal(await h.run(), "done");
    assert.deepEqual(nodes, [
      ENGINE_PROFILE.pass2.nodes,
      ENGINE_PROFILE.pass2.multipv,
      ENGINE_PROFILE.pass2.nodes,
      ENGINE_PROFILE.pass2.multipv,
    ]);
    const row = h.store.games.get("7")!.comparisons.get("11")!;
    assert.equal(row.status, "READY");
    const e = (row.facts as { evalAtDivergence: { userWin: number; legendWin: number } }).evalAtDivergence;
    assert.ok(e.userWin >= 0 && e.userWin <= 100 && e.legendWin >= 0 && e.legendWin <= 100);
    assert.deepEqual(
      h.sent("compare:ready").map((s) => [s.data, s.userRefs]),
      [[{ v: 1, gameRef: REF, status: "ready" }, [USER.userRef]]],
    );
    assert.equal(h.queue.jobs[0]!.status, "DONE");
    assert.equal(h.telemetry.spans[0]!.name, "job.legend_compare");
  });

  it("a member who followed the legend has nothing to search: READY at once", async () => {
    const h = await setup("followed");
    assert.equal(await h.run(), "done");
    assert.equal(h.engines[0]!.searches, 0);
    assert.equal(h.store.games.get("7")!.comparisons.get("11")!.status, "READY");
    assert.equal(h.sent("compare:ready").length, 1);
  });

  it("an already READY row is confirmed without a search", async () => {
    const h = await setup("opera", { status: "READY" });
    assert.equal(await h.run(), "done");
    assert.equal(h.engines[0]!.searches, 0);
    assert.equal(h.sent("compare:ready").length, 1);
  });

  it("the last failed attempt marks the row FAILED and tells the member", async () => {
    const h = await setup("opera", { attempts: 2, engineFails: true });
    assert.equal(await h.run(), "failed");
    assert.equal(h.queue.jobs[0]!.status, "FAILED");
    assert.equal(h.store.games.get("7")!.comparisons.get("11")!.status, "FAILED");
    assert.deepEqual(
      h.sent("compare:ready").map((s) => s.data),
      [{ v: 1, gameRef: REF, status: "failed" }],
    );
  });

  it("an earlier failed attempt only backs off (the row stays FACTS_READY, no event)", async () => {
    const h = await setup("opera", { attempts: 0, engineFails: true });
    assert.equal(await h.run(), "failed");
    assert.equal(h.queue.jobs[0]!.status, "QUEUED");
    assert.equal(h.store.games.get("7")!.comparisons.get("11")!.status, "FACTS_READY");
    assert.equal(h.sent("compare:ready").length, 0);
  });
});
