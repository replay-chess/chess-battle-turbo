// Phase-04 plan 8.5.3, 12.1 (`activation-machine.test.ts`): every transition, stalled at exactly 12 s, failed then
// active within 30 s, poll stop at 180 s, countdown pause/resume; and the 5.7 poll schedule.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COUNTDOWN_MS,
  FAILED_GRACE_MS,
  POLL_STOP_MS,
  STALLED_AFTER_MS,
  activationPollDelay,
  activationReducer,
  countdownSeconds,
  initMachine,
  type MachineInit,
  type MachineState,
} from "./activation-machine";

const T0 = 1_000_000;
const init = (over: Partial<MachineInit> = {}): MachineState =>
  initMachine({ kind: "checkout", now: T0, initial: "pending", urlStatusFailed: false, isReturn: true, ...over });

describe("initMachine", () => {
  it("pending → polling; ?status=failed → failed (url_status); a recorded failure → failed (declined)", () => {
    assert.equal(init().phase, "polling");
    const urlFailed = init({ urlStatusFailed: true });
    assert.deepEqual([urlFailed.phase, urlFailed.failReason, urlFailed.failedAt], ["failed", "url_status", T0]);
    assert.deepEqual([init({ initial: "failed" }).phase, init({ initial: "failed" }).failReason], ["failed", "declined"]);
  });

  it("entitled at arrival: success via `already`; with no checkout return it is 'already a member' without a countdown", () => {
    const returned = init({ initial: "active" });
    assert.deepEqual([returned.phase, returned.via, returned.alreadyMember], ["success", "already", false]);
    assert.equal(returned.countdown?.remainingMs, COUNTDOWN_MS);
    const direct = init({ initial: "active", isReturn: false });
    assert.deepEqual([direct.alreadyMember, direct.countdown], [true, null]);
  });

  it("onboarding never counts down", () => {
    assert.equal(init({ kind: "onboarding", initial: "active" }).countdown, null);
  });
});

describe("activationReducer", () => {
  it("polling → success on a server `active` (poll / self_heal) or the socket", () => {
    const poll = activationReducer(init(), { type: "SERVER", state: "active", at: T0 + 3_000 });
    assert.deepEqual([poll.phase, poll.via], ["success", "poll"]);
    const heal = activationReducer(init(), { type: "SERVER", state: "active", selfHeal: true, at: T0 + 7_000 });
    assert.equal(heal.via, "self_heal");
    const socket = activationReducer(init(), { type: "SOCKET_ENTITLED", at: T0 + 900 });
    assert.deepEqual([socket.phase, socket.via], ["success", "socket"]);
  });

  it("pending answers change nothing", () => {
    const s = init();
    assert.equal(activationReducer(s, { type: "SERVER", state: "pending", at: T0 + 2_000 }), s);
  });

  it("stalled at exactly 12 s, not a millisecond earlier; polling continues", () => {
    const s = init();
    assert.equal(activationReducer(s, { type: "TICK", at: T0 + STALLED_AFTER_MS - 1 }).phase, "polling");
    const stalled = activationReducer(s, { type: "TICK", at: T0 + STALLED_AFTER_MS });
    assert.equal(stalled.phase, "stalled");
    assert.equal(stalled.pollStopped, false);
    assert.deepEqual(activationReducer(stalled, { type: "SERVER", state: "active", at: T0 + 20_000 }).phase, "success");
  });

  it("Check Again from stalled restarts polling and the stalled timer", () => {
    const stalled = activationReducer(init(), { type: "TICK", at: T0 + STALLED_AFTER_MS });
    const again = activationReducer(stalled, { type: "CHECK_AGAIN", at: T0 + 40_000 });
    assert.deepEqual([again.phase, again.stalledFrom], ["polling", T0 + 40_000]);
    assert.equal(activationReducer(again, { type: "TICK", at: T0 + 40_000 + STALLED_AFTER_MS - 1 }).phase, "polling");
    assert.equal(activationReducer(again, { type: "TICK", at: T0 + 40_000 + STALLED_AFTER_MS }).phase, "stalled");
  });

  it("the 180 s stop keeps the phase (polling shows stalled) and Check Again restarts the poller", () => {
    const stopped = activationReducer(init(), { type: "POLL_STOPPED", at: T0 + POLL_STOP_MS });
    assert.deepEqual([stopped.phase, stopped.pollStopped], ["stalled", true]);
    const restarted = activationReducer(stopped, { type: "CHECK_AGAIN", at: T0 + POLL_STOP_MS + 5 });
    assert.deepEqual([restarted.phase, restarted.pollStopped], ["polling", false]);
    const success = activationReducer(init({ initial: "active" }), { type: "POLL_STOPPED", at: T0 + 1 });
    assert.equal(success.phase, "success");
  });

  it("polling → failed on a server failure or ?status=failed; failed → success only within 30 s", () => {
    const failed = activationReducer(init(), { type: "SERVER", state: "failed", reason: "cancelled", at: T0 + 2_000 });
    assert.deepEqual([failed.phase, failed.failReason], ["failed", "cancelled"]);
    const urlFailed = activationReducer(init(), { type: "URL_STATUS_FAILED", at: T0 });
    assert.equal(urlFailed.failReason, "url_status");
    const inGrace = activationReducer(failed, { type: "SERVER", state: "active", at: T0 + 2_000 + FAILED_GRACE_MS });
    assert.deepEqual([inGrace.phase, inGrace.failedAt, inGrace.failReason], ["success", null, null]);
    const late = activationReducer(failed, { type: "SERVER", state: "active", at: T0 + 2_001 + FAILED_GRACE_MS });
    assert.equal(late.phase, "failed");
    assert.equal(activationReducer(failed, { type: "SOCKET_ENTITLED", at: T0 + 10_000 }).phase, "success");
    assert.equal(activationReducer(failed, { type: "TICK", at: T0 + 60_000 }).phase, "failed");
  });

  it("a socket payment-failure hint changes nothing by itself (the refetch decides)", () => {
    const s = init();
    assert.equal(activationReducer(s, { type: "SOCKET_PAYMENT_FAILED", at: T0 + 1 }), s);
  });

  it("success is terminal: later failures, ticks and Check Again do not move it", () => {
    const s = activationReducer(init(), { type: "SOCKET_ENTITLED", at: T0 + 1_000 });
    assert.equal(activationReducer(s, { type: "SERVER", state: "failed", at: T0 + 2_000 }).phase, "success");
    assert.equal(activationReducer(s, { type: "URL_STATUS_FAILED", at: T0 + 2_000 }).phase, "success");
    assert.equal(activationReducer(s, { type: "CHECK_AGAIN", at: T0 + 2_000 }).phase, "success");
  });

  it("countdown: 3 s to navigate; paused while focused/hovered; resumes where it stopped", () => {
    let s = activationReducer(init(), { type: "SERVER", state: "active", at: T0 });
    assert.equal(countdownSeconds(s), 3);
    s = activationReducer(s, { type: "TICK", at: T0 + 1_000 });
    assert.equal(s.countdown?.remainingMs, 2_000);
    s = activationReducer(s, { type: "COUNTDOWN_PAUSE", at: T0 + 1_500 });
    assert.deepEqual([s.countdown?.remainingMs, s.countdown?.paused], [1_500, true]);
    s = activationReducer(s, { type: "TICK", at: T0 + 9_000 });
    assert.equal(s.countdown?.remainingMs, 1_500, "a paused countdown does not move");
    s = activationReducer(s, { type: "COUNTDOWN_RESUME", at: T0 + 10_000 });
    s = activationReducer(s, { type: "TICK", at: T0 + 11_000 });
    assert.deepEqual([s.countdown?.remainingMs, s.navigate], [500, false]);
    s = activationReducer(s, { type: "TICK", at: T0 + 11_500 });
    assert.deepEqual([s.countdown?.remainingMs, s.navigate, countdownSeconds(s)], [0, true, 0]);
  });
});

describe("activationPollDelay (plan 5.7)", () => {
  it("2 s × 6, 5 s × 12, then 15 s; stops at 180 s", () => {
    const delays = Array.from({ length: 22 }, (_, n) => activationPollDelay(n, 1_000));
    assert.deepEqual(delays.slice(0, 6), [2_000, 2_000, 2_000, 2_000, 2_000, 2_000]);
    assert.ok(delays.slice(6, 18).every((d) => d === 5_000));
    assert.ok(delays.slice(18).every((d) => d === 15_000));
    assert.equal(activationPollDelay(3, POLL_STOP_MS - 1), 2_000);
    assert.equal(activationPollDelay(3, POLL_STOP_MS), false);
  });

  it("passive: 5 s × 6 then 15 s, same 180 s stop", () => {
    assert.equal(activationPollDelay(0, 0, true), 5_000);
    assert.equal(activationPollDelay(5, 0, true), 5_000);
    assert.equal(activationPollDelay(6, 0, true), 15_000);
    assert.equal(activationPollDelay(6, POLL_STOP_MS, true), false);
  });
});
