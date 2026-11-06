import assert from "node:assert/strict";
import { test } from "node:test";
import { chargeMove, ewma, flagAt, freezeClocks, lagCredit, remaining, spentFromClocks } from "../src/clock/clock";
import { clockTone, formatClock, formatCountdown } from "../src/clock/format";
import type { Clocks } from "../src/machine/types";

const running = (w: number, b: number, run: "w" | "b", at: number): Clocks => ({ w, b, run, at });
const base = { premove: false, rttMs: 0, lagUsedMs: 0, initialMs: 300_000, incrementMs: 3_000 };

test("spend without lag credit charges the elapsed time and adds the increment", () => {
  const r = chargeMove({ ...base, clocks: running(100_000, 90_000, "w", 1_000), mover: "w", now: 6_000 });
  assert.ok(!r.flagged);
  if (r.flagged) return;
  assert.equal(r.spentMs, 5_000);
  assert.equal(r.clockMs, 100_000 - 5_000 + 3_000);
  assert.deepEqual(r.clocks, { w: 98_000, b: 90_000, run: "b", at: 6_000 });
});

test("lag credit is half the RTT, capped at 250 ms and at 5 % of the initial time per game", () => {
  assert.equal(lagCredit({ premove: false, rttMs: 200, usedMs: 0, initialMs: 300_000 }), 100);
  assert.equal(lagCredit({ premove: false, rttMs: 2_000, usedMs: 0, initialMs: 300_000 }), 250);
  // 5 % of 60 s = 3 s; 2.9 s already used → only 100 ms left.
  assert.equal(lagCredit({ premove: false, rttMs: 2_000, usedMs: 2_900, initialMs: 60_000 }), 100);
  assert.equal(lagCredit({ premove: false, rttMs: 2_000, usedMs: 3_000, initialMs: 60_000 }), 0);
  const r = chargeMove({ ...base, rttMs: 300, clocks: running(100_000, 90_000, "w", 0), mover: "w", now: 1_000 });
  assert.ok(!r.flagged && r.spentMs === 850 && r.lagCreditMs === 150);
});

// regression (INTEGRATE-2): an EWMA RTT of 441.8 ms gave a credit of 220.9 ms and fractional clocks, which the
// socket's checkpoint could not write to the int[] / int columns (Postgres 22P03).
test("lag credit and the charged clocks are whole milliseconds for a fractional RTT", () => {
  assert.equal(lagCredit({ premove: false, rttMs: 441.8, usedMs: 0, initialMs: 300_000 }), 220);
  const r = chargeMove({ ...base, rttMs: 441.8, clocks: running(100_000, 90_000, "w", 0), mover: "w", now: 1_000 });
  assert.ok(!r.flagged);
  if (!r.flagged) {
    for (const v of [r.clocks.w, r.clocks.b, r.clockMs, r.spentMs, r.lagCreditMs]) assert.ok(Number.isInteger(v), String(v));
  }
});

test("a premove costs at least 100 ms and gets no lag credit", () => {
  const r = chargeMove({
    ...base,
    premove: true,
    rttMs: 400,
    clocks: running(100_000, 90_000, "w", 5_000),
    mover: "w",
    now: 5_010,
  });
  assert.ok(!r.flagged && r.spentMs === 100 && r.lagCreditMs === 0);
  assert.equal(lagCredit({ premove: true, rttMs: 400, usedMs: 0, initialMs: 300_000 }), 0);
});

test("a move whose spend reaches the remaining time flags instead", () => {
  const r = chargeMove({ ...base, clocks: running(2_000, 90_000, "w", 0), mover: "w", now: 2_000 });
  assert.ok(r.flagged);
  const ok = chargeMove({ ...base, clocks: running(2_000, 90_000, "w", 0), mover: "w", now: 1_999 });
  assert.ok(!ok.flagged);
});

test("remaining, freeze, flagAt, ewma and derived spends", () => {
  const c = running(10_000, 20_000, "b", 1_000);
  assert.equal(remaining(c, "b", 6_000), 15_000);
  assert.equal(remaining(c, "w", 6_000), 10_000);
  assert.equal(remaining(c, "b", 100_000), 0);
  const f = freezeClocks(c, 6_000);
  assert.deepEqual(f, { clocks: { w: 10_000, b: 15_000, run: null, at: 6_000 }, run: "b" });
  assert.equal(flagAt(c), 21_000);
  assert.equal(ewma(150, 250), 170);
  assert.equal(ewma(undefined, 90), 90);
  assert.deepEqual(spentFromClocks([300_000, 300_000, 290_000, 280_000], 300_000, 2_000), [0, 0, 12_000, 22_000]);
});

test("format(): m:ss, tenths under 10 s, 0:00 at zero", () => {
  assert.equal(formatClock(600_000), "10:00");
  assert.equal(formatClock(61_000), "1:01");
  assert.equal(formatClock(60_000), "1:00");
  assert.equal(formatClock(10_000), "0:10");
  assert.equal(formatClock(9_960), "0:09.9");
  assert.equal(formatClock(9_600), "0:09.6");
  assert.equal(formatClock(40), "0:00.0");
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(-5), "0:00");
  assert.equal(formatClock(3_725_000), "1:02:05");
  assert.equal(formatCountdown(29_100), "0:30");
  assert.equal(formatCountdown(0), "0:00");
});

test("colour thresholds at 60 s and 20 s; red text idle at zero", () => {
  assert.equal(clockTone(60_001, true), "default");
  assert.equal(clockTone(60_000, true), "amber");
  assert.equal(clockTone(20_001, true), "amber");
  assert.equal(clockTone(20_000, true), "red");
  assert.equal(clockTone(5_000, false), "default");
  assert.equal(clockTone(0, false), "zero");
});
