// Live-region text (features/game/liveText.ts): a message is shown, then the region empties, so a screen reader that
// reads the page later never finds stale text ("Connection lost. Reconnecting." a minute after recovery).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createLiveText } from "./liveText";

function fakeTimers() {
  let now = 0;
  let next = 1;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    timers: {
      setTimeout: (fn: () => void, ms: number) => {
        const id = next++;
        due.set(id, { at: now + ms, fn });
        return id;
      },
      clearTimeout: (id: unknown) => void due.delete(id as number),
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...due].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) {
          due.delete(id);
          t.fn();
        }
      }
    },
  };
}

test("a message is shown, then the region empties after the hold", () => {
  const t = fakeTimers();
  const seen: string[] = [];
  const live = createLiveText((s) => seen.push(s), 5_000, t.timers);
  live.say("Connection lost. Reconnecting.");
  t.advance(4_999);
  assert.deepEqual(seen, ["Connection lost. Reconnecting."]);
  t.advance(1);
  assert.deepEqual(seen, ["Connection lost. Reconnecting.", ""]);
});

test("a new message restarts the hold; the same message is bumped so it is read again", () => {
  const t = fakeTimers();
  const seen: string[] = [];
  const live = createLiveText((s) => seen.push(s), 5_000, t.timers);
  live.say("You: e4.");
  t.advance(3_000);
  live.say("You: e4.");
  t.advance(3_000);
  assert.deepEqual(seen, ["You: e4.", "You: e4.\u00a0"], "not emptied 6 s after the first, 3 s after the second");
  t.advance(2_000);
  assert.equal(seen.at(-1), "");
  live.say("You: e4.");
  assert.equal(seen.at(-1), "You: e4.", "after emptying, the plain text is new again");
});

test("dispose cancels the pending clear; empty text is ignored", () => {
  const t = fakeTimers();
  const seen: string[] = [];
  const live = createLiveText((s) => seen.push(s), 5_000, t.timers);
  live.say("");
  assert.deepEqual(seen, []);
  live.say("Back online.");
  live.dispose();
  t.advance(10_000);
  assert.deepEqual(seen, ["Back online."]);
});
