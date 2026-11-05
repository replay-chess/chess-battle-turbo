import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_RETRY_AFTER_SEC,
  MAX_RETRY_AFTER_SEC,
  formatMmSs,
  normalizeRetryAfter,
  remainingSec,
  startCountdown,
} from "./countdown";

describe("formatMmSs", () => {
  it("formats whole seconds as m:ss", () => {
    assert.equal(formatMmSs(0), "0:00");
    assert.equal(formatMmSs(5), "0:05");
    assert.equal(formatMmSs(30), "0:30");
    assert.equal(formatMmSs(65), "1:05");
    assert.equal(formatMmSs(600), "10:00");
    assert.equal(formatMmSs(3600), "60:00");
  });

  it("rounds fractions up so the label never reads 0:00 while time is left", () => {
    assert.equal(formatMmSs(0.1), "0:01");
    assert.equal(formatMmSs(29.75), "0:30");
    assert.equal(formatMmSs(59.001), "1:00");
  });

  it("clamps negatives and non-numbers to 0:00", () => {
    assert.equal(formatMmSs(-3), "0:00");
    assert.equal(formatMmSs(Number.NaN), "0:00");
    assert.equal(formatMmSs(Number.POSITIVE_INFINITY), "0:00");
  });
});

describe("normalizeRetryAfter", () => {
  it("keeps valid seconds, rounding up", () => {
    assert.equal(normalizeRetryAfter(30), 30);
    assert.equal(normalizeRetryAfter(0), 0);
    assert.equal(normalizeRetryAfter(4.2), 5);
    assert.equal(normalizeRetryAfter("12"), 12);
  });

  it("falls back to 30 s on missing or invalid input", () => {
    assert.equal(normalizeRetryAfter(undefined), DEFAULT_RETRY_AFTER_SEC);
    assert.equal(normalizeRetryAfter(-1), DEFAULT_RETRY_AFTER_SEC);
    assert.equal(normalizeRetryAfter("abc"), DEFAULT_RETRY_AFTER_SEC);
    assert.equal(normalizeRetryAfter(""), DEFAULT_RETRY_AFTER_SEC);
    assert.equal(normalizeRetryAfter(null, 10), 10);
  });

  it("caps at one day", () => {
    assert.equal(normalizeRetryAfter(10 ** 9), MAX_RETRY_AFTER_SEC);
  });
});

describe("remainingSec", () => {
  it("subtracts the monotonic delta and never goes negative", () => {
    assert.equal(remainingSec(30, 1000, 1000), 30);
    assert.equal(remainingSec(30, 1000, 11_000), 20);
    assert.equal(remainingSec(30, 1000, 31_000), 0);
    assert.equal(remainingSec(30, 1000, 99_000), 0);
  });

  it("ignores a clock that went backwards", () => {
    assert.equal(remainingSec(30, 5000, 4000), 30);
  });
});

describe("startCountdown with a fake clock", () => {
  it("counts down from the received seconds", () => {
    let now = 500_000; // arbitrary monotonic origin: only deltas matter
    const c = startCountdown(30, () => now);
    assert.equal(c.totalSec, 30);
    assert.equal(c.label(), "0:30");
    assert.equal(c.done(), false);

    now += 250;
    assert.equal(c.label(), "0:30"); // 29.75 s rounds up

    now += 750;
    assert.equal(c.label(), "0:29");

    now += 19_000;
    assert.equal(c.label(), "0:10");
    assert.equal(c.waitedSec(), 20);

    now += 9_999;
    assert.equal(c.label(), "0:01");
    assert.equal(c.done(), false);

    now += 1;
    assert.equal(c.label(), "0:00");
    assert.equal(c.done(), true);
    assert.equal(c.waitedSec(), 30);
  });

  it("does not depend on wall-clock time (a skewed Date.now changes nothing)", () => {
    let now = 0;
    const realDateNow = Date.now;
    try {
      Date.now = () => realDateNow() + 3_600_000; // the device clock is an hour ahead
      const c = startCountdown(65, () => now);
      assert.equal(c.label(), "1:05");
      now = 5_000;
      assert.equal(c.label(), "1:00");
    } finally {
      Date.now = realDateNow;
    }
  });

  it("normalises a bad wait to the 30 s default", () => {
    const c = startCountdown(Number.NaN, () => 0);
    assert.equal(c.totalSec, DEFAULT_RETRY_AFTER_SEC);
  });

  it("a zero wait is done at once", () => {
    const c = startCountdown(0, () => 0);
    assert.equal(c.done(), true);
    assert.equal(c.label(), "0:00");
  });
});
