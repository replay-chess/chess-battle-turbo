// One server-restart stage for the chip and the banner (restartStage, @repo/game-core/client/viewState). Dev recheck
// 2026-11-12 run 3: the chip still read "Server restarting in 0:01 · … Keep playing." while the banner said "clocks
// are paused" (the socket had dropped before the announced restart time).
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveViewState, restartStage } from "@repo/game-core/client/viewState";
import { CHIPS } from "./copy";
import { buildDemoFixture } from "./demo/fixtures";

test("announced while the game still runs; paused once the socket drops, the game freezes or the time comes", () => {
  const f = buildDemoFixture({ state: "your_move" });
  const now = f.serverNow;
  assert.equal(restartStage(f.game, now), "none");
  const announced = { ...f.game, conn: "live" as const, restarting: { restartAt: now + 1_000 } };
  assert.equal(restartStage(announced, now), "announced");
  assert.equal(restartStage({ ...announced, conn: "reconnecting" as const }, now), "paused", "socket down before the time");
  assert.equal(restartStage({ ...announced, conn: "offline" as const }, now), "paused");
  assert.equal(restartStage(announced, now + 1_000), "paused", "the restart time has come");
  const frozen = { ...f.game, state: { ...f.game.state, frozen: { since: now, reason: "restart" as const } } };
  assert.equal(restartStage(frozen, now), "paused", "restored and frozen, no restart notice");
  assert.equal(restartStage({ ...frozen, restarting: { restartAt: now + 30_000 } }, now), "paused");
});

test("the demo restart variant (banner shown) never reads as 'Keep playing'", () => {
  const f = buildDemoFixture({ state: "reconnecting", variant: "restart" });
  assert.equal(deriveViewState(f.game, f.serverNow).zone, "reconnect");
  assert.equal(restartStage(f.game, f.serverNow), "paused");
  assert.doesNotMatch(CHIPS.restartingNow, /Keep playing|in \d/);
});

test("the demo restart_announced variant: the game runs on, no banner, the chip counts down", () => {
  const f = buildDemoFixture({ state: "your_move", variant: "restart_announced" });
  assert.equal(restartStage(f.game, f.serverNow), "announced");
  assert.notEqual(deriveViewState(f.game, f.serverNow).zone, "reconnect");
});
