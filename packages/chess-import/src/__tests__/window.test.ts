// Import window and month plan (phase-04 plan §8.6 "Window" and step 3).
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { MonthKey } from "../chesscom/types";
import { importWindowStart, monthKeyOf, monthsToFetch, previousMonthKey } from "../window";

const at = (iso: string) => Date.parse(iso);
const months = (...k: string[]) => k as MonthKey[];

describe("importWindowStart", () => {
  it("is the first UTC day of the month 12 months back", () => {
    assert.equal(new Date(importWindowStart(at("2026-11-12T09:00:00Z"))).toISOString(), "2025-11-01T00:00:00.000Z");
    assert.equal(new Date(importWindowStart(at("2026-01-01T00:00:00Z"))).toISOString(), "2025-01-01T00:00:00.000Z");
    assert.equal(new Date(importWindowStart(at("2026-03-31T23:59:59Z"), 3)).toISOString(), "2025-12-01T00:00:00.000Z");
    assert.throws(() => importWindowStart(0, 0), RangeError);
  });

  it("month keys", () => {
    assert.equal(monthKeyOf(at("2026-01-31T23:59:59Z")), "2026/01");
    assert.equal(previousMonthKey("2026/01"), "2025/12");
    assert.equal(previousMonthKey("2026/10"), "2026/09");
  });
});

describe("monthsToFetch", () => {
  const listed = months("2024/05", "2025/10", "2025/11", "2026/08", "2026/09", "2026/10", "2026/11");

  it("initial: every listed month in the window, newest first", () => {
    assert.deepEqual(monthsToFetch({ nowMs: at("2026-11-12T09:00:00Z"), archiveMonths: listed, stored: {}, initial: true }), [
      "2026/11",
      "2026/10",
      "2026/09",
      "2026/08",
      "2025/11",
    ]);
  });

  it("incremental: the current month and months newer than the newest stored; done months skipped", () => {
    const stored = { "2026/09": { done: true }, "2026/08": { done: true } };
    assert.deepEqual(
      monthsToFetch({ nowMs: at("2026-11-12T09:00:00Z"), archiveMonths: listed, stored, initial: false }),
      ["2026/11", "2026/10"],
    );
  });

  it("incremental on the 1st or 2nd also re-reads the previous month", () => {
    const stored = { "2026/10": { done: true }, "2026/11": { done: false } };
    const on2nd = monthsToFetch({ nowMs: at("2026-12-02T03:05:00Z"), archiveMonths: [...listed, "2026/12" as MonthKey], stored, initial: false });
    assert.deepEqual(on2nd, ["2026/12", "2026/11"]);
    const stored2 = { "2026/10": { done: true }, "2026/11": { done: true } };
    const on3rd = monthsToFetch({ nowMs: at("2026-12-03T03:05:00Z"), archiveMonths: [...listed, "2026/12" as MonthKey], stored: stored2, initial: false });
    assert.deepEqual(on3rd, ["2026/12"]);
  });

  it("incremental re-reads a stored month that is not done (it was current when last read)", () => {
    const stored = { "2026/09": { done: true }, "2026/10": { done: false } };
    assert.deepEqual(
      monthsToFetch({ nowMs: at("2026-11-20T03:05:00Z"), archiveMonths: listed, stored, initial: false }),
      ["2026/11", "2026/10"],
    );
  });
});
