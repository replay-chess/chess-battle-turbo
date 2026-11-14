// labels.ts: day labels in three zones, played-at, greeting, clock and interval labels (phase-05 plan §8.14, §12.1).
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { atLabel, dayLabel, estimateMinutes, greetingPart, intervalLabel, minutesLabel, playedAtLabel, plural, releaseLabel, weekdayLabel } from "./labels";

// Thursday 2026-11-12 19:00Z (the contract fixtures' clock).
const NOW = new Date("2026-11-12T19:00:00Z");
const at = (s: string) => new Date(s);

describe("dayLabel", () => {
  it("in UTC: Today, Tomorrow, weekdays within 6 days, then the date", () => {
    assert.equal(dayLabel(at("2026-11-12T08:00:00Z"), NOW, "UTC"), "Today", "overdue reads as today");
    assert.equal(dayLabel(at("2026-11-12T22:00:00Z"), NOW, "UTC"), "Today");
    assert.equal(dayLabel(at("2026-11-13T08:00:00Z"), NOW, "UTC"), "Tomorrow");
    assert.equal(dayLabel(at("2026-11-14T08:00:00Z"), NOW, "UTC"), "Sat");
    assert.equal(dayLabel(at("2026-11-14T08:00:00Z"), NOW, "UTC", { long: true }), "Saturday");
    assert.equal(dayLabel(at("2026-11-18T08:00:00Z"), NOW, "UTC"), "Wed");
    assert.equal(dayLabel(at("2026-11-19T08:00:00Z"), NOW, "UTC"), "Nov 19");
    assert.equal(dayLabel(at("2026-12-06T08:00:00Z"), NOW, "UTC"), "Dec 6");
  });

  it("in Asia/Kolkata the same instants fall on other local days", () => {
    // NOW is 00:30 on Friday the 13th in Kolkata.
    assert.equal(dayLabel(at("2026-11-13T02:30:00Z"), NOW, "Asia/Kolkata"), "Today");
    assert.equal(dayLabel(at("2026-11-14T02:30:00Z"), NOW, "Asia/Kolkata"), "Tomorrow");
    assert.equal(dayLabel(at("2026-11-12T08:00:00Z"), NOW, "Asia/Kolkata"), "Today");
    assert.equal(dayLabel(at("2026-11-15T02:30:00Z"), NOW, "Asia/Kolkata"), "Sun");
  });

  it("in America/New_York (14:00 on Thursday)", () => {
    assert.equal(dayLabel(at("2026-11-13T03:00:00Z"), NOW, "America/New_York"), "Today", "22:00 Thursday local");
    assert.equal(dayLabel(at("2026-11-13T13:00:00Z"), NOW, "America/New_York"), "Tomorrow");
    assert.equal(dayLabel(at("2026-11-21T13:00:00Z"), NOW, "America/New_York"), "Nov 21");
  });
});

describe("playedAtLabel", () => {
  it("says today, yesterday or the date", () => {
    assert.equal(playedAtLabel(at("2026-11-12T10:00:00Z"), NOW, "UTC"), "today");
    assert.equal(playedAtLabel(at("2026-11-11T23:59:00Z"), NOW, "UTC"), "yesterday");
    assert.equal(playedAtLabel(at("2026-10-27T12:00:00Z"), NOW, "UTC"), "Oct 27");
    // 20:00Z on the 11th is 01:30 on the 12th in Kolkata, and NOW is the 13th there: yesterday.
    assert.equal(playedAtLabel(at("2026-11-11T20:00:00Z"), NOW, "Asia/Kolkata"), "yesterday");
  });
});

describe("greeting and clock", () => {
  it("splits the day into morning, afternoon and evening", () => {
    assert.equal(greetingPart(at("2026-11-12T05:00:00Z"), "UTC"), "morning");
    assert.equal(greetingPart(at("2026-11-12T11:59:00Z"), "UTC"), "morning");
    assert.equal(greetingPart(at("2026-11-12T12:00:00Z"), "UTC"), "afternoon");
    assert.equal(greetingPart(at("2026-11-12T17:59:00Z"), "UTC"), "afternoon");
    assert.equal(greetingPart(NOW, "UTC"), "evening");
    assert.equal(greetingPart(at("2026-11-12T04:59:00Z"), "UTC"), "evening");
    assert.equal(greetingPart(NOW, "Asia/Kolkata"), "evening", "00:30 local");
    assert.equal(greetingPart(NOW, "America/New_York"), "afternoon", "14:00 local");
  });

  it("formats HH:mm in the zone and the next-batch phrase", () => {
    assert.equal(atLabel(at("2026-11-13T08:00:00Z"), "UTC"), "08:00");
    assert.equal(atLabel(at("2026-11-13T02:30:00Z"), "Asia/Kolkata"), "08:00");
    assert.equal(atLabel(at("2026-11-12T18:15:00Z"), "Pacific/Chatham"), "08:00");
    assert.equal(releaseLabel(at("2026-11-13T08:00:00Z"), NOW, "UTC"), "tomorrow at 08:00");
    assert.equal(releaseLabel(at("2026-11-12T20:00:00Z"), NOW, "UTC"), "today at 20:00");
    assert.equal(releaseLabel(at("2026-11-14T08:00:00Z"), NOW, "UTC"), "Sat at 08:00");
    assert.equal(weekdayLabel("2026-11-12"), "Thursday");
    assert.equal(weekdayLabel("2026-11-12", { short: true }), "Thu");
  });
});

describe("intervals and estimates", () => {
  it("formats grade-button intervals", () => {
    const cases: [number, string][] = [
      [0, "< 10 min"],
      [10 / 1440, "< 10 min"],
      [15 / 1440, "15 min"],
      [59 / 1440, "59 min"],
      [3 / 24, "3 h"],
      [1, "1 day"],
      [2, "2 days"],
      [13, "13 days"],
      [14, "2 weeks"],
      [19, "3 weeks"],
      [59, "8 weeks"],
      [60, "2 months"],
      [90, "3 months"],
      [180, "6 months"],
    ];
    for (const [days, label] of cases) assert.equal(intervalLabel(days), label, `${days} days`);
  });

  it("estimates minutes as the plan does (0.75 per bank item, 1.3 per puzzle, min 1)", () => {
    assert.equal(estimateMinutes({ bank: 3 }), 2);
    assert.equal(estimateMinutes({ bank: 1 }), 1);
    assert.equal(estimateMinutes({ bank: 10 }), 8);
    assert.equal(estimateMinutes({ puzzles: 3 }), 4);
    assert.equal(estimateMinutes({ weakness: 10 }), 5);
    assert.equal(estimateMinutes({ lessonSec: 360 }), 6);
    assert.equal(estimateMinutes({}), 0);
    assert.equal(minutesLabel(2), "~2 min");
    assert.equal(minutesLabel(0.2), "~1 min");
    assert.equal(plural(1, "mistake"), "1 mistake");
    assert.equal(plural(3, "mistake"), "3 mistakes");
  });
});
