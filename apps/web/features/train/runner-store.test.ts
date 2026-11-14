// The runner store (phase-05 plan §4.4, §5.4 step 3, §8.6, T4/T5): grades advance, Again on pass 1 re-queues the
// pass-2 copy at min(i + 4, length) with the after-Again previews, broken items are skipped, resume merges the outbox,
// the puzzle rating previews with Glicko-2 and the server's value replaces it, streams wait for and append extends.
import assert from "node:assert/strict";
import { test } from "node:test";
import { extendResultFixture, sessionPayloadFixture, AFTER_AGAIN_PREVIEW } from "@repo/contracts/http/fixtures/p05";
import { createRunnerStore, currentView, mergeOutbox, pass2Copy, progressLabel, withLocalRequeues, type RunnerStore } from "./runner-store";
import { applyScript } from "./script";
import { attemptsFixture } from "@repo/contracts/http/fixtures/p05";
import { previewRating } from "./rating";
import { buildAttempt, backInLabel } from "./useGrade";

const bank = sessionPayloadFixture("bank");
const puzzles = sessionPayloadFixture("puzzles");

/** Plays the current item's whole line (opponent replies included). */
function solve(store: RunnerStore): void {
  const s = store.getState();
  const it = s.items[s.index]!;
  if (s.run?.phase === "setup") s.dispatch({ type: "setup_done" });
  it.solution.forEach((uci, i) => {
    if (i % 2 === 0) store.getState().dispatch({ type: "move", uci });
    else store.getState().dispatch({ type: "reply_done" });
  });
}

test("T4/T5: Good, Hard, Again; the Again re-queues at the end (fewer than 3 remain) with after-Again previews", () => {
  const store = createRunnerStore({ payload: bank, now: 0 });
  solve(store);
  assert.equal(store.getState().grade("good", 1000)?.graded.firstTry, true);
  assert.equal(store.getState().index, 1);
  store.getState().dispatch({ type: "hint" });
  solve(store);
  const hard = store.getState().grade("good", 2000);
  assert.equal(hard?.graded.suggested, "hard", "overriding Hard to Good is allowed");
  store.getState().dispatch({ type: "move", uci: bank.items[2]!.context!.playedUci });
  store.getState().dispatch({ type: "show_solution" });
  for (let i = 0; i < 3; i++) store.getState().dispatch({ type: "sol_step" });
  const again = store.getState().grade("again", 3000);
  assert.equal(again?.requeued, true);
  const s = store.getState();
  assert.deepEqual(s.items.map((it) => it.itemId), ["i1", "i2", "i3", "i3b"]);
  assert.equal(s.index, 3);
  assert.equal(s.items[3]!.pass, 2);
  assert.deepEqual(s.items[3]!.preview, AFTER_AGAIN_PREVIEW);
  assert.equal(s.items[3]!.previewAfterAgain, null);
  // Pass 2 graded Again is never re-queued again; the session is done.
  store.getState().dispatch({ type: "show_solution" });
  for (let i = 0; i < 3; i++) store.getState().dispatch({ type: "sol_step" });
  assert.equal(store.getState().grade("again", 4000)?.requeued, false);
  assert.equal(store.getState().done, true);
  assert.equal(store.getState().graded.length, 4);
  assert.equal(progressLabel(store.getState()), "4 of 4");
});

test("Again on pass 1 with items left goes 3 items later (min(i + 4, length))", () => {
  const long = { ...bank, items: [...bank.items, ...bank.items.map((it, i) => ({ ...it, itemId: `j${i}` }))] };
  const store = createRunnerStore({ payload: long, now: 0 });
  store.getState().dispatch({ type: "show_solution" });
  for (let i = 0; i < 3; i++) store.getState().dispatch({ type: "sol_step" });
  store.getState().grade("again", 10);
  assert.equal(store.getState().items[4]!.itemId, "i1b");
});

test("grade() only works on a graded item and reports the interval and timeMs", () => {
  const store = createRunnerStore({ payload: bank, now: 0 });
  assert.equal(store.getState().grade("good", 10), null);
  solve(store);
  const c = store.getState().grade("easy", 7_500)!;
  assert.equal(c.intervalLabel, bank.items[0]!.preview!.easy.label);
  assert.equal(c.timeMs, 7_500);
  assert.equal(backInLabel("4 days"), "Back in 4 days");
  assert.equal(backInLabel("< 10 min"), "Back in under 10 min");
});

test("buildAttempt carries the flags, the session and the optimistic-concurrency reps", () => {
  const store = createRunnerStore({ payload: bank, now: 0 });
  store.getState().dispatch({ type: "move", uci: "b2b3" });
  store.getState().dispatch({ type: "retry" });
  store.getState().dispatch({ type: "hint" });
  solve(store);
  const a = buildAttempt(store.getState(), "hard", bank.ref, new Date(5_000), "00000000-0000-4000-8000-000000000001")!;
  assert.deepEqual(
    { ...a, reviewedAt: "x" },
    {
      clientAttemptId: "00000000-0000-4000-8000-000000000001",
      sessionRef: bank.ref,
      itemId: "i1",
      cardRef: bank.items[0]!.cardRef,
      puzzleId: null,
      kind: "mistake",
      solved: true,
      firstTry: false,
      hintsUsed: 1,
      wrongMovesUci: ["b2b3"],
      solutionShown: false,
      timeMs: 5_000,
      grade: "hard",
      suggestedGrade: "again",
      cardReps: 0,
      reviewedAt: "x",
    },
  );
});

test("a broken item is skipped and reported once", () => {
  const broken = { ...bank.items[0]!, itemId: "ibroken", solution: ["a1a8"] };
  const store = createRunnerStore({ payload: { ...bank, items: [broken, ...bank.items] }, now: 0 });
  assert.deepEqual(store.getState().broken, ["ibroken"]);
  assert.equal(store.getState().items[store.getState().index]!.itemId, "i1");
  assert.ok(currentView(store.getState()));
});

test("resume: the outbox's graded items and Agains are merged in before the first render", () => {
  // i1 graded Again and i2 graded Good on the device, not flushed yet; another session's attempt is ignored.
  const [a, b, c] = attemptsFixture(3);
  const outbox = [
    { attempt: { ...a!, sessionRef: bank.ref, itemId: "i1", grade: "again" as const, reviewedAt: "2026-11-12T19:00:00.000Z" } },
    { attempt: { ...b!, sessionRef: bank.ref, itemId: "i2", grade: "good" as const, reviewedAt: "2026-11-12T19:01:00.000Z" } },
    { attempt: { ...c!, sessionRef: "cm5t9s3ss0009slzpotherses", itemId: "i3", grade: "good" as const, reviewedAt: "2026-11-12T19:02:00.000Z" } },
  ];
  const entries = mergeOutbox(bank, outbox);
  assert.deepEqual(entries, { resumeIndex: 2, pendingAgain: ["i1"] });
  const store = createRunnerStore({ payload: bank, resumeIndex: entries.resumeIndex, pendingAgain: entries.pendingAgain, now: 0 });
  assert.deepEqual(store.getState().items.map((it) => it.itemId), ["i1", "i2", "i3", "i1b"]);
  assert.equal(store.getState().index, 2);
  assert.equal(store.getState().startIndex, 2);
  assert.deepEqual(withLocalRequeues(bank.items, ["i1", "i1"]).map((it) => it.itemId), ["i1", "i2", "i3", "i1b"], "replays are idempotent");
  assert.equal(pass2Copy(bank.items[0]!).previewAfterAgain, null);
});

test("puzzles: a solve previews the Glicko rating (+ the delta), a miss lowers it; the server's newest value wins", () => {
  const store = createRunnerStore({ payload: puzzles, now: 0 });
  solve(store);
  const s = store.getState();
  const expected = previewRating(puzzles.header.rating!, puzzles.items[0]!.rating!, 1);
  assert.equal(s.rating!.value, expected.next.value);
  assert.ok((s.ratingDelta ?? 0) > 0);
  assert.equal(s.solveStreak, puzzles.header.solveStreak + 1);
  store.getState().grade("good", 100);
  assert.equal(store.getState().ratingDelta, null, "the delta belongs to the solved item only");
  store.getState().dispatch({ type: "setup_done" });
  store.getState().dispatch({ type: "show_solution" });
  for (let i = 0; i < 3; i++) store.getState().dispatch({ type: "sol_step" });
  assert.ok((store.getState().ratingDelta ?? 0) < 0);
  assert.equal(store.getState().solveStreak, 0);
  const results = [
    { clientAttemptId: "00000000-0000-4000-8000-00000000000a", status: "ok" as const, rating: { value: 1400, delta: -1, provisional: false } },
    { clientAttemptId: "00000000-0000-4000-8000-00000000000b", status: "ok" as const, rating: { value: 1530, delta: 12, provisional: false } },
  ];
  store.getState().applyResults(results, { ratingFrom: "00000000-0000-4000-8000-00000000000b", capRemaining: 3 });
  assert.equal(store.getState().rating!.value, 1530);
  assert.equal(store.getState().capRemaining, null, "puzzle sessions have no cap");
});

test("FIX-1 rating-sync: a pass-2 copy never moves the chip; the server's whole Glicko state replaces the client's", () => {
  // The reviewer's repro: show the solution on i1, grade Again, then reach i1b (pass 2) and solve it.
  const store = createRunnerStore({ payload: puzzles, now: 0 });
  store.getState().dispatch({ type: "setup_done" });
  store.getState().dispatch({ type: "show_solution" });
  for (let i = 0; i < 3; i++) store.getState().dispatch({ type: "sol_step" });
  store.getState().grade("again", 100);
  while (store.getState().items[store.getState().index]!.pass !== 2) {
    solve(store);
    store.getState().grade("good", 200);
  }
  const before = store.getState().rating!;
  solve(store);
  assert.equal(store.getState().items[store.getState().index]!.itemId, "i1b");
  assert.deepEqual(store.getState().rating, before, "the server does not rate a pass-2 copy, so neither does the chip");
  assert.equal(store.getState().ratingDelta, null);
  // The server's state after the batch: r, RD and volatility all replace the client's (not only the rounded value).
  const server = { value: 1418.37, rd: 81.2, vol: 0.0601, provisional: true };
  store.getState().applyResults([{ clientAttemptId: "00000000-0000-4000-8000-00000000000c", status: "ok", rating: { value: 1418, delta: 9, provisional: true } }], {
    ratingFrom: "00000000-0000-4000-8000-00000000000c",
    rating: server,
  });
  assert.deepEqual(store.getState().rating, server);
});

test("FIX-2 solve streak: a pass-2 copy neither extends nor resets the header streak (W1 counts pass 1 only)", () => {
  // The reviewer's p7: good, good, Again with the solution shown, then the pass-2 copy solved first try.
  for (const pass2 of ["solve", "miss"] as const) {
    const store = createRunnerStore({ payload: { ...bank, header: { ...bank.header, solveStreak: 0 } }, now: 0 });
    solve(store);
    store.getState().grade("good", 100);
    solve(store);
    store.getState().grade("good", 200);
    assert.equal(store.getState().solveStreak, 2);
    store.getState().dispatch({ type: "setup_done" });
    store.getState().dispatch({ type: "show_solution" });
    assert.equal(store.getState().solveStreak, 0, "a shown solution on pass 1 resets it");
    while (store.getState().run?.phase !== "graded") store.getState().dispatch({ type: "sol_step" });
    store.getState().grade("again", 300);
    while (store.getState().items[store.getState().index]!.pass !== 2) {
      solve(store);
      store.getState().grade("good", 400);
    }
    const before = store.getState().solveStreak;
    if (pass2 === "solve") solve(store);
    else {
      const s = store.getState();
      if (s.run?.phase === "setup") s.dispatch({ type: "setup_done" });
      store.getState().dispatch({ type: "show_solution" });
    }
    assert.equal(store.getState().solveStreak, before, `a pass-2 ${pass2} leaves the streak as the server keeps it`);
  }
});

test("FIX-1 rating-sync: practice never previews a rating", () => {
  const store = createRunnerStore({ payload: { ...puzzles, kind: "practice" }, now: 0 });
  const before = store.getState().rating;
  solve(store);
  assert.deepEqual(store.getState().rating, before);
});

test("streams: waiting at the end for an extend, then its items continue the session", () => {
  const two = { ...puzzles, items: puzzles.items.slice(0, 1) };
  const store = createRunnerStore({ payload: two, now: 0 });
  store.getState().setExtend("pending");
  solve(store);
  store.getState().grade("good", 10);
  assert.equal(store.getState().done, false, "waits for the extend");
  store.getState().appendItems(extendResultFixture().items, true);
  assert.equal(store.getState().done, false);
  assert.equal(store.getState().items[store.getState().index]!.itemId, "i11");
  assert.ok(store.getState().run);
});

test("streams: a failed extend ends the session at the current batch", () => {
  const one = { ...puzzles, items: puzzles.items.slice(0, 1) };
  const store = createRunnerStore({ payload: one, now: 0 });
  store.getState().setExtend("pending");
  solve(store);
  store.getState().grade("good", 10);
  store.getState().setExtend("failed");
  assert.equal(store.getState().done, true);
});

test("skip advances without a grade; end() stops the session", () => {
  const store = createRunnerStore({ payload: bank, now: 0 });
  assert.equal(store.getState().skip(5)?.itemId, "i1");
  assert.deepEqual(store.getState().skipped, ["i1"]);
  assert.equal(store.getState().index, 1);
  store.getState().end();
  assert.equal(store.getState().done, true);
  assert.equal(store.getState().run, null);
});

test("an empty payload is done at once", () => {
  assert.equal(createRunnerStore({ payload: sessionPayloadFixture("caughtup") }).getState().done, true);
});

test("demo scripts reach each board state through real moves", () => {
  const solved = createRunnerStore({ payload: puzzles });
  applyScript(solved, [{ type: "move", uci: "b5c7" }, { type: "move", uci: "c7d5" }]);
  assert.equal(solved.getState().run?.phase, "graded");
  const shown = createRunnerStore({ payload: bank });
  applyScript(shown, [{ type: "solution" }]);
  assert.equal(shown.getState().run?.phase, "graded");
  assert.equal(shown.getState().run?.shown, true);
  const done = createRunnerStore({ payload: bank });
  applyScript(done, bank.items.flatMap((it) => [...it.solution.filter((_, i) => i % 2 === 0).map((uci) => ({ type: "move" as const, uci })), { type: "grade" as const, grade: "good" as const }]));
  assert.equal(done.getState().done, true);
  assert.equal(applyScript(createRunnerStore({ payload: puzzles }), [{ type: "themes" }]).themes, true);
});

test("streams: an extend answer with nothing new ends the stream instead of asking again (regression: extend-after-pass2)", () => {
  const store = createRunnerStore({ payload: puzzles, now: 0 });
  assert.equal(store.getState().stream, true);
  const held = store.getState().items.slice(-2);
  store.getState().setExtend("pending");
  store.getState().appendItems(held, true);
  assert.equal(store.getState().extend, "ended", "no new items: never back to idle (that re-fired the request at once)");
  assert.equal(store.getState().stream, false);
});
