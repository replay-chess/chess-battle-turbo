// day.ts: the local training day (phase-05 plan §8.4, §12.1): the day starts at dayStartHour, so 02:00 belongs to
// yesterday; DST days and 30/45-minute zones keep the right key.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { addDaysToKey, dayAnchorOf, dayKey, dayStart, daysBetween, isInDay, mondayOf, trainingDayAt, weekdayOfKey, weekKeys } from "./day";

const at = (s: string) => new Date(s);

describe("dayKey", () => {
  it("puts 02:00 in yesterday and 04:00 in today with the default start hour 4", () => {
    assert.equal(dayKey(at("2026-11-12T02:00:00Z"), "UTC", 4), "2026-11-11");
    assert.equal(dayKey(at("2026-11-12T03:59:59Z"), "UTC", 4), "2026-11-11");
    assert.equal(dayKey(at("2026-11-12T04:00:00Z"), "UTC", 4), "2026-11-12");
    assert.equal(dayKey(at("2026-11-12T23:59:59Z"), "UTC", 4), "2026-11-12");
  });

  it("matches the persona tool's probe (03:00 UTC with start 4 is the previous day)", () => {
    assert.equal(dayKey(at("2026-11-12T03:00:00.000Z"), "UTC", 4), "2026-11-11");
  });

  it("uses the member's zone, not the server's", () => {
    // 22:00Z on the 12th is 03:30 on the 13th in Kolkata: still the 12th's training day.
    assert.equal(dayKey(at("2026-11-12T22:00:00Z"), "Asia/Kolkata", 4), "2026-11-12");
    // 23:00Z is 04:30 in Kolkata: the 13th.
    assert.equal(dayKey(at("2026-11-12T23:00:00Z"), "Asia/Kolkata", 4), "2026-11-13");
    // Chatham (+13:45): 14:30Z is 04:15 the next day.
    assert.equal(dayKey(at("2026-11-12T14:30:00Z"), "Pacific/Chatham", 4), "2026-11-13");
    assert.equal(dayKey(at("2026-11-12T14:00:00Z"), "Pacific/Chatham", 4), "2026-11-12");
    // New York on the fall-back day: 08:59Z is 03:59 EST, 09:00Z is 04:00 EST (the wall clock decides, not real hours).
    assert.equal(dayKey(at("2026-11-01T08:59:00Z"), "America/New_York", 4), "2026-10-31");
    assert.equal(dayKey(at("2026-11-01T09:00:00Z"), "America/New_York", 4), "2026-11-01");
  });

  it("with dayStartHour 0 is the plain local date", () => {
    assert.equal(dayKey(at("2026-11-12T23:30:00Z"), "Europe/London", 0), "2026-11-12");
    assert.equal(dayKey(at("2026-11-12T18:30:00Z"), "Asia/Kolkata", 0), "2026-11-13");
  });
});

describe("day arithmetic", () => {
  it("moves keys, counts days and finds the week", () => {
    assert.equal(addDaysToKey("2026-11-12", 1), "2026-11-13");
    assert.equal(addDaysToKey("2026-03-01", -1), "2026-02-28");
    assert.equal(daysBetween("2026-11-10", "2026-11-12"), 2);
    assert.equal(daysBetween("2026-11-12", "2026-11-10"), -2);
    assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2, "across the London DST change");
    assert.equal(weekdayOfKey("2026-11-12"), 3);
    assert.equal(mondayOf("2026-11-12"), "2026-11-09");
    assert.equal(mondayOf("2026-11-09"), "2026-11-09");
    assert.equal(mondayOf("2026-11-15"), "2026-11-09");
    assert.deepEqual(weekKeys("2026-11-12"), ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
  });

  it("gives the instant a training day starts", () => {
    assert.equal(dayStart("2026-11-12", "UTC", 4).toISOString(), "2026-11-12T04:00:00.000Z");
    assert.equal(dayStart("2026-11-12", "Asia/Kolkata", 4).toISOString(), "2026-11-11T22:30:00.000Z");
    assert.equal(dayStart("2026-11-01", "America/New_York", 4).toISOString(), "2026-11-01T09:00:00.000Z");
    assert.equal(dayStart("2026-10-31", "America/New_York", 4).toISOString(), "2026-10-31T08:00:00.000Z");
    assert.ok(isInDay(at("2026-11-12T03:59:00Z"), "2026-11-11", "UTC", 4));
    assert.ok(!isInDay(at("2026-11-12T04:00:00Z"), "2026-11-11", "UTC", 4));
  });

  it("agrees with dayKey at every day start", () => {
    for (const tz of ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York", "Australia/Lord_Howe", "Pacific/Chatham"]) {
      for (let i = 0; i < 400; i++) {
        const key = addDaysToKey("2026-01-01", i);
        const start = dayStart(key, tz, 4);
        assert.equal(dayKey(start, tz, 4), key, `${tz} ${key}`);
        assert.equal(dayKey(new Date(start.getTime() - 1), tz, 4), addDaysToKey(key, -1), `${tz} just before ${key}`);
      }
    }
  });
});

describe("the day in progress across a zone change (FIX-1 tz-pin)", () => {
  const H = 3_600_000;
  const utcDay = { day: "2026-11-12", timeZone: "UTC", dayStartHour: 4 };

  it("is dayKey in the current zone with no anchor or an anchor in the same zone", () => {
    const at = new Date("2026-11-12T19:00:00Z");
    assert.equal(trainingDayAt(at, "UTC", 4, null).key, "2026-11-12");
    assert.equal(trainingDayAt(at, "UTC", 4, utcDay).key, "2026-11-12");
    assert.equal(trainingDayAt(at, "Pacific/Kiritimati", 4, null).key, "2026-11-13");
  });

  it("moving east mid-day keeps today until it ends where it began (the reviewer's UTC → Kiritimati probe)", () => {
    const at = new Date("2026-11-12T19:00:00Z");
    const w = trainingDayAt(at, "Pacific/Kiritimati", 4, utcDay);
    assert.equal(w.key, "2026-11-12");
    assert.equal(w.start.toISOString(), "2026-11-12T04:00:00.000Z");
    assert.equal(w.end.toISOString(), "2026-11-13T04:00:00.000Z", "the UTC day's end (later than Kiritimati's)");
    const after = trainingDayAt(new Date("2026-11-13T05:00:00Z"), "Pacific/Kiritimati", 4, utcDay);
    assert.equal(after.key, "2026-11-13", "then Kiritimati's day (local 19:00 on the 13th)");
    assert.equal(after.start.toISOString(), "2026-11-13T04:00:00.000Z", "starting where the pinned day ended");
  });

  it("moving west never goes back a day: the anchored day lasts until the new zone's day ends", () => {
    const kiri = { day: "2026-11-13", timeZone: "Pacific/Kiritimati", dayStartHour: 4 };
    // Kiritimati's 13th ends at 2026-11-12T14:00Z; UTC's day 13 ends at 2026-11-14T04:00Z.
    const at = new Date("2026-11-12T16:00:00Z");
    assert.equal(dayKey(at, "UTC", 4), "2026-11-12", "the natural UTC key would go back to the 12th");
    const w = trainingDayAt(at, "UTC", 4, kiri);
    assert.equal(w.key, "2026-11-13");
    assert.equal(w.end.toISOString(), "2026-11-14T04:00:00.000Z");
    assert.equal(trainingDayAt(new Date("2026-11-14T05:00:00Z"), "UTC", 4, kiri).key, "2026-11-14");
  });

  it("windows tile time: consecutive instants never map to a smaller key", () => {
    for (const [tz, anchor] of [
      ["Pacific/Kiritimati", utcDay],
      ["America/New_York", { day: "2026-11-13", timeZone: "Asia/Kolkata", dayStartHour: 4 }],
      ["UTC", { day: "2026-11-12", timeZone: "UTC", dayStartHour: 6 }],
    ] as const) {
      let prev = "";
      for (let t = Date.parse("2026-11-10T00:00:00Z"); t < Date.parse("2026-11-16T00:00:00Z"); t += H / 2) {
        const w = trainingDayAt(new Date(t), tz, 4, anchor);
        assert.ok(w.key >= prev, `${tz}: ${w.key} after ${prev}`);
        assert.ok(w.start.getTime() <= t && t < w.end.getTime(), `${tz}: ${new Date(t).toISOString()} outside its window`);
        prev = w.key;
      }
    }
  });

  it("a day-start change takes effect from the next day (W8): today keeps its key", () => {
    const at = new Date("2026-11-12T05:00:00Z"); // 05:00 UTC: day 12 at start hour 4, day 11 at start hour 6
    assert.equal(trainingDayAt(at, "UTC", 6, utcDay).key, "2026-11-12");
  });

  it("dayAnchorOf takes the newest row that records its zone", () => {
    assert.equal(dayAnchorOf([]), null);
    assert.equal(dayAnchorOf([{ day: "2026-11-12", timeZone: null, dayStartHour: null }]), null);
    assert.deepEqual(
      dayAnchorOf([
        { day: "2026-11-11", timeZone: "UTC", dayStartHour: 4 },
        { day: "2026-11-12", timeZone: "Asia/Kolkata", dayStartHour: 4 },
        { day: "2026-11-13", timeZone: null, dayStartHour: null },
      ]),
      { day: "2026-11-12", timeZone: "Asia/Kolkata", dayStartHour: 4 },
    );
  });
});
