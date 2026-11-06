import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTranscript } from "@repo/game-core/testing/scenarios";
import { replayTranscript } from "@repo/game-core/testing/harness";
import { createGameStore, nextClientMoveId } from "./store";

test("client move ids fit the contract (≤ 16 chars of [A-Za-z0-9_-]) and do not repeat", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2_000; i++) {
    const id = nextClientMoveId();
    assert.match(id, /^[A-Za-z0-9_-]{1,16}$/);
    assert.equal(seen.has(id), false);
    seen.add(id);
  }
});

test("dispatch runs the reducer, replaces the state and returns the effects", () => {
  const { store: base } = replayTranscript(buildTranscript("your_move"));
  const store = createGameStore(base.state, { joined: true, conn: "live", now: 0 });
  let notified = 0;
  store.subscribe(() => notified++);
  const out = store.dispatch({ type: "select", square: "e1" });
  assert.deepEqual(out, []);
  assert.equal(store.getState().selected, "e1");
  assert.equal(notified, 1);
  // A no-op action keeps the identity and does not notify.
  store.dispatch({ type: "premove", uci: null, now: 0 });
  assert.equal(notified, 1);
});
