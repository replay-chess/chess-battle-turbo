// extract/coalesce.ts (phase-05 plan §7.4, §12.2): `mistakes:added` at most once per user per 60 s (fake clock), the
// counters of every extraction in between summed into one trailing frame, no frame when no card was added, the
// per-minute dedupe key, and every pending user flushed at shutdown.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MISTAKES_ADDED_MIN_GAP_MS, mistakesAddedDedupeKey, MistakesAddedEvent } from "@repo/contracts/socket/user";
import { silentLogger } from "../obs/log";
import { FakeClock } from "../scheduler/clock";
import { RecordingEmitter } from "../socket/emit";
import { MistakesAddedCoalescer } from "./coalesce";

const T0 = Date.UTC(2026, 10, 12, 19, 0, 0);
const delta = (cardsAdded: number, over: Partial<{ added: number; total: number; bankDue: number }> = {}) => ({
  games: 1,
  added: over.added ?? 2,
  cardsAdded,
  total: over.total ?? 10,
  bankDue: over.bankDue ?? 3,
});

function setup() {
  const clock = new FakeClock(T0);
  const emitter = new RecordingEmitter();
  const c = new MistakesAddedCoalescer({ emitter, clock, log: silentLogger });
  const frames = () => emitter.sent.filter((s) => s.event === "mistakes:added");
  return { clock, emitter, c, frames };
}

describe("MistakesAddedCoalescer", () => {
  it("sends the first extraction at once, then at most one frame per 60 s with the sums", async () => {
    const { clock, c, frames } = setup();
    await c.add("cu1", delta(1, { total: 5, bankDue: 1 }));
    assert.equal(frames().length, 1);
    assert.deepEqual(frames()[0]!.data, { v: 1, games: 1, added: 2, cardsAdded: 1, total: 5, bankDue: 1 });
    assert.equal(frames()[0]!.dedupeKey, mistakesAddedDedupeKey("cu1", T0));
    assert.deepEqual(frames()[0]!.userRefs, ["cu1"]);

    await clock.advance(10_000);
    await c.add("cu1", delta(1, { total: 6, bankDue: 2 }));
    await clock.advance(10_000);
    await c.add("cu1", delta(2, { total: 8, bankDue: 4 }));
    assert.equal(frames().length, 1, "inside the window: held back");
    assert.equal(c.pendingUsers, 1);

    await clock.advance(MISTAKES_ADDED_MIN_GAP_MS - 20_000);
    assert.equal(frames().length, 2, "the trailing flush when the window ends");
    const second = MistakesAddedEvent.parse(frames()[1]!.data);
    assert.deepEqual(second, { v: 1, games: 2, added: 4, cardsAdded: 3, total: 8, bankDue: 4 });
    assert.equal(c.pendingUsers, 0);
  });

  it("users are independent", async () => {
    const { c, frames } = setup();
    await c.add("cu1", delta(1));
    await c.add("cu2", delta(1));
    assert.deepEqual(
      frames().map((f) => f.userRefs[0]),
      ["cu1", "cu2"],
    );
  });

  it("no frame when the extractions added no card", async () => {
    const { clock, c, frames } = setup();
    await c.add("cu1", delta(0));
    assert.equal(frames().length, 0);
    await c.add("cu1", delta(1));
    assert.equal(frames().length, 1);
    await clock.advance(5_000);
    await c.add("cu1", delta(0));
    await clock.advance(MISTAKES_ADDED_MIN_GAP_MS);
    assert.equal(frames().length, 1, "a window with no new card sends nothing");
  });

  it("flushAll sends every pending user at shutdown and stops the timer", async () => {
    const { clock, c, frames } = setup();
    await c.add("cu1", delta(1));
    await clock.advance(1_000);
    await c.add("cu1", delta(1));
    assert.equal(frames().length, 1);
    await c.flushAll();
    assert.equal(frames().length, 2);
    await clock.advance(MISTAKES_ADDED_MIN_GAP_MS * 2);
    assert.equal(frames().length, 2, "no timer left");
  });
});
