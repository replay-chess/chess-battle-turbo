// tz.ts: wall time ↔ instant across DST in the plan's test zones (phase-05 plan §8.4, §12.1). The package's test
// script runs the whole suite twice, under TZ=UTC and TZ=Asia/Kolkata: nothing here may depend on the process zone.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { addDays, calendarDaysBetween, formatYmd, isValidTimeZone, localParts, parseYmd, tzOffsetMs, weekdayOf, zonedToUtc } from "./tz";

const iso = (d: Date) => d.toISOString();

describe("zonedToUtc", () => {
  it("resolves ordinary wall times in every test zone", () => {
    assert.equal(iso(zonedToUtc(2026, 11, 13, 8, 0, "Etc/UTC")), "2026-11-13T08:00:00.000Z");
    assert.equal(iso(zonedToUtc(2026, 11, 13, 8, 0, "UTC")), "2026-11-13T08:00:00.000Z");
    assert.equal(iso(zonedToUtc(2026, 11, 13, 8, 0, "Asia/Kolkata")), "2026-11-13T02:30:00.000Z");
    assert.equal(iso(zonedToUtc(2026, 11, 13, 8, 0, "Europe/London")), "2026-11-13T08:00:00.000Z");
    assert.equal(iso(zonedToUtc(2026, 7, 13, 8, 0, "Europe/London")), "2026-07-13T07:00:00.000Z");
    assert.equal(iso(zonedToUtc(2026, 11, 13, 8, 0, "America/New_York")), "2026-11-13T13:00:00.000Z");
    assert.equal(iso(zonedToUtc(2026, 11, 13, 8, 0, "Australia/Lord_Howe")), "2026-11-12T21:00:00.000Z");
    assert.equal(iso(zonedToUtc(2026, 11, 13, 8, 0, "Pacific/Chatham")), "2026-11-12T18:15:00.000Z");
  });

  it("gives the earlier instant for an ambiguous fall-back time", () => {
    // Europe/London, DST ends 2026-10-25 02:00 BST → 01:00 GMT: 01:30 happens twice (00:30Z and 01:30Z).
    assert.equal(iso(zonedToUtc(2026, 10, 25, 1, 30, "Europe/London")), "2026-10-25T00:30:00.000Z");
    // America/New_York, DST ends 2026-11-01 02:00 EDT → 01:00 EST: 01:30 is 05:30Z or 06:30Z.
    assert.equal(iso(zonedToUtc(2026, 11, 1, 1, 30, "America/New_York")), "2026-11-01T05:30:00.000Z");
    // Australia/Lord_Howe, 30-minute DST ends 2026-04-05 02:00 → 01:30: 01:45 is 14:45Z (+11) or 15:15Z (+10:30).
    assert.equal(iso(zonedToUtc(2026, 4, 5, 1, 45, "Australia/Lord_Howe")), "2026-04-04T14:45:00.000Z");
    // Pacific/Chatham, DST ends 2026-04-05 03:45 → 02:45: 03:00 is 13:15Z (+13:45) or 14:15Z (+12:45).
    assert.equal(iso(zonedToUtc(2026, 4, 5, 3, 0, "Pacific/Chatham")), "2026-04-04T13:15:00.000Z");
  });

  it("gives the first valid instant after a spring-forward gap", () => {
    // America/New_York 2026-03-08: 02:00 EST jumps to 03:00 EDT (07:00Z). 02:30 does not exist.
    assert.equal(iso(zonedToUtc(2026, 3, 8, 2, 30, "America/New_York")), "2026-03-08T07:00:00.000Z");
    // Europe/London 2026-03-29: 01:00 GMT jumps to 02:00 BST (01:00Z).
    assert.equal(iso(zonedToUtc(2026, 3, 29, 1, 30, "Europe/London")), "2026-03-29T01:00:00.000Z");
    // Australia/Lord_Howe 2026-10-04: 02:00 (+10:30) jumps to 02:30 (+11), i.e. 15:30Z the day before.
    assert.equal(iso(zonedToUtc(2026, 10, 4, 2, 15, "Australia/Lord_Howe")), "2026-10-03T15:30:00.000Z");
    // Pacific/Chatham 2026-09-27: 02:45 (+12:45) jumps to 03:45 (+13:45), i.e. 14:00Z the day before.
    assert.equal(iso(zonedToUtc(2026, 9, 27, 3, 0, "Pacific/Chatham")), "2026-09-26T14:00:00.000Z");
  });

  it("round-trips every quarter hour of the DST days through localParts", () => {
    const zones = ["Europe/London", "America/New_York", "Asia/Kolkata", "Australia/Lord_Howe", "Pacific/Chatham", "Etc/UTC"];
    const days: [number, number, number][] = [
      [2026, 10, 25],
      [2026, 11, 1],
      [2026, 3, 8],
      [2026, 3, 29],
      [2026, 4, 5],
      [2026, 10, 4],
      [2026, 9, 27],
    ];
    for (const tz of zones) {
      for (const [y, m, d] of days) {
        for (let q = 0; q < 96; q++) {
          const h = Math.floor(q / 4);
          const min = (q % 4) * 15;
          const t = zonedToUtc(y, m, d, h, min, tz);
          const p = localParts(t, tz);
          const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
          const asked = Date.UTC(y, m - 1, d, h, min);
          // Either the exact wall time, or (inside a gap) the first instant after it, at most one hour later.
          assert.ok(wall >= asked && wall - asked <= 3_600_000, `${tz} ${y}-${m}-${d} ${h}:${min} → ${t.toISOString()}`);
          if (wall === asked) {
            // An exact answer is the earliest instant showing that wall time.
            const earlier = localParts(new Date(t.getTime() - 3_600_000), tz);
            assert.ok(!(earlier.y === y && earlier.m === m && earlier.d === d && earlier.h === h && earlier.min === min), `${tz} ${y}-${m}-${d} ${h}:${min} is not the earlier instant`);
          }
        }
      }
    }
  });
});

describe("offsets and calendar helpers", () => {
  it("reports the zone offset including 30- and 45-minute zones", () => {
    assert.equal(tzOffsetMs(new Date("2026-11-13T00:00:00Z"), "Asia/Kolkata"), 330 * 60_000);
    assert.equal(tzOffsetMs(new Date("2026-11-13T00:00:00Z"), "Pacific/Chatham"), 825 * 60_000);
    assert.equal(tzOffsetMs(new Date("2026-06-13T00:00:00Z"), "Pacific/Chatham"), 765 * 60_000);
    assert.equal(tzOffsetMs(new Date("2026-11-13T00:00:00Z"), "Australia/Lord_Howe"), 660 * 60_000);
    assert.equal(tzOffsetMs(new Date("2026-06-13T00:00:00Z"), "Australia/Lord_Howe"), 630 * 60_000);
    assert.equal(tzOffsetMs(new Date("2026-11-13T00:00:00Z"), "America/New_York"), -300 * 60_000);
  });

  it("reads local parts with Monday = 0", () => {
    const p = localParts(new Date("2026-11-12T19:00:00Z"), "Asia/Kolkata");
    assert.deepEqual(p, { y: 2026, m: 11, d: 13, h: 0, min: 30, s: 0, weekday: 4 });
    assert.equal(weekdayOf({ y: 2026, m: 11, d: 9 }), 0);
    assert.equal(weekdayOf({ y: 2026, m: 11, d: 15 }), 6);
  });

  it("does calendar arithmetic across months and years", () => {
    assert.deepEqual(addDays({ y: 2026, m: 12, d: 31 }, 1), { y: 2027, m: 1, d: 1 });
    assert.deepEqual(addDays({ y: 2028, m: 3, d: 1 }, -1), { y: 2028, m: 2, d: 29 });
    assert.equal(calendarDaysBetween({ y: 2026, m: 10, d: 24 }, { y: 2026, m: 10, d: 26 }), 2);
    assert.equal(formatYmd({ y: 2026, m: 1, d: 5 }), "2026-01-05");
    assert.deepEqual(parseYmd("2026-02-28"), { y: 2026, m: 2, d: 28 });
    assert.throws(() => parseYmd("2026-02-30"));
    assert.throws(() => parseYmd("2026-2-3"));
  });

  it("validates zone names", () => {
    assert.ok(isValidTimeZone("Asia/Kolkata"));
    assert.ok(isValidTimeZone("Etc/UTC"));
    assert.ok(!isValidTimeZone("Mars/Olympus"));
    assert.ok(!isValidTimeZone(""));
  });
});
