// view-store.ts: the per-instance view state and the URL mirror (CDL D8: ?tab, ?ply, ?m with replaceState).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createReviewViewStore, urlFor, viewFromSearch } from "./view-store";

test("the store starts in the move list or in a moment and steps between them", () => {
  const s = createReviewViewStore({ ply: 53 });
  assert.deepEqual([s.getState().mode, s.getState().tab, s.getState().ply], ["moves", "coach", 53]);
  s.getState().setPly(36);
  s.getState().flip();
  assert.equal(s.getState().flipped, true);
  s.getState().enterMoment(1);
  assert.deepEqual([s.getState().mode, s.getState().momentIndex, s.getState().phase], ["moment", 1, "ask"]);
  s.getState().setPhase("tried", { tried: "e2e4" });
  s.getState().enterMoment(2);
  assert.equal(s.getState().tried, null, "a new moment starts clean");
  s.getState().leaveMoments();
  assert.equal(s.getState().mode, "moves");
  assert.equal(s.getState().ply, 36, "the ply survives the walkthrough");
  const m = createReviewViewStore({ ply: 0, momentIndex: 0, writing: true });
  assert.deepEqual([m.getState().mode, m.getState().writing], ["moment", true]);
});

test("walkthrough events queue and drain once; a failed batch goes back to the front", () => {
  const s = createReviewViewStore({ ply: 0 });
  const a = { type: "viewed" as const, ply: 32, at: "2026-11-09T18:50:00.000Z" };
  const b = { type: "revealed" as const, ply: 32, at: "2026-11-09T18:50:05.000Z" };
  s.getState().queueEvent(a);
  assert.equal(s.getState().drainEvents().length, 1);
  assert.equal(s.getState().drainEvents().length, 0);
  s.getState().queueEvent(b);
  s.getState().requeueEvents([a]);
  assert.deepEqual(s.getState().drainEvents(), [a, b]);
});

test("a moment's first result wins; a new moment starts clean; the walk start is kept once", () => {
  const s = createReviewViewStore({ ply: 0, momentIndex: 0 });
  s.getState().setPhase("tried", { tried: "c3d5", triedSan: "Nd5", wrong: 1, planChip: "trade" });
  s.getState().settleMoment("found_retry", 2);
  s.getState().settleMoment("revealed", 2);
  assert.deepEqual(s.getState().results, { 0: "found_retry" });
  assert.deepEqual(s.getState().attempts, { 0: 2 });
  s.getState().enterMoment(1);
  const v = s.getState();
  assert.deepEqual([v.phase, v.tried, v.triedSan, v.wrong, v.planChip, v.accepted, v.lineN], ["ask", null, null, 0, null, null, -1]);
  s.getState().startWalk(1_000);
  s.getState().startWalk(2_000);
  assert.equal(s.getState().walkStartedAt, 1_000);
});

test("the demo can open a moment in any sub-state; outside a moment the sub-state is ignored", () => {
  const m = createReviewViewStore({ ply: 0, momentIndex: 1, phase: { phase: "line", lineN: 3 } });
  assert.deepEqual([m.getState().mode, m.getState().momentIndex, m.getState().phase, m.getState().lineN], ["moment", 1, "line", 3]);
  const n = createReviewViewStore({ ply: 0, phase: { phase: "reveal" } });
  assert.equal(n.getState().phase, "ask");
});

test("search params: tab, ply (−1 allowed) and the 1-based moment", () => {
  assert.deepEqual(viewFromSearch({ tab: "moves", ply: "36", m: "2" }), { tab: "moves", ply: 36, momentIndex: 1 });
  assert.deepEqual(viewFromSearch({ tab: "x", ply: "-1", m: "0" }), { tab: null, ply: -1, momentIndex: null });
  assert.deepEqual(viewFromSearch({ ply: "abc", m: "4" }), { tab: null, ply: null, momentIndex: null });
  assert.deepEqual(viewFromSearch({}), { tab: null, ply: null, momentIndex: null });
});

test("the URL keeps only what differs from the defaults and other params untouched", () => {
  const q = new URLSearchParams("from=game_over");
  assert.equal(urlFor("/review/r1", q, { tab: "coach", ply: 53, mode: "moves", momentIndex: 0 }, 53), "/review/r1?from=game_over");
  assert.equal(urlFor("/review/r1", q, { tab: "moves", ply: 36, mode: "moves", momentIndex: 0 }, 53), "/review/r1?from=game_over&tab=moves&ply=36");
  assert.equal(urlFor("/review/r1", new URLSearchParams("tab=moves&ply=3"), { tab: "moves", ply: 36, mode: "moment", momentIndex: 1 }, 53), "/review/r1?m=2");
});
