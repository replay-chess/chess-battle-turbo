// regression: hub-device-clock (CI 43620776665, bank-states caughtup on a phone: "Next 6 reviews arrive today at 08:00."
// for a batch the server had due tomorrow). The hub and the bank label `nextBatch.at` against the page's clock: the
// server's render time kept running by the device's elapsed time, never the device's own date. Over every hour of a day
// in several zones (around midnight UTC, the 04:00 day start and the 08:00 release), and whatever the device clock says
// (days behind, hours behind, a few minutes fast, hours ahead, days ahead, or the CI runner's 17:41 UTC), the word is
// the one the server's clock gives.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anchoredNow, dayWord } from "./when";

const ZONES = ["UTC", "America/New_York", "America/Los_Angeles", "Asia/Kolkata", "Pacific/Auckland"] as const;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function localParts(ms: number, timeZone: string): { date: string; h: number; m: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour), m: Number(p.minute) };
}

/** The next local 08:00 strictly after `ms` (the persona release hour), on a 15-minute grid. */
function nextRelease(ms: number, timeZone: string): number {
  let t = Math.floor(ms / (15 * 60_000)) * 15 * 60_000 + 15 * 60_000;
  for (;;) {
    const p = localParts(t, timeZone);
    if (p.h === 8 && p.m === 0) return t;
    t += 15 * 60_000;
  }
}

/** The member's training day start (the persona default, 04:00 local). */
const DAY_START = 4;

/** The training day an instant belongs to: the local date, or the day before while the local clock is before 04:00. */
function trainingDay(ms: number, timeZone: string): string {
  const p = localParts(ms, timeZone);
  return p.h < DAY_START ? localParts(ms - DAY_START * HOUR, timeZone).date : p.date;
}

/**
 * "today" when the release falls in the server's training day, else "tomorrow" (it is always within a day). Between
 * 00:00 and 04:00 the training day is still yesterday's, so the 08:00 release later that night is "tomorrow"
 * (browser pass D4, P5-FZ-4: the hub's header names the training day).
 */
function expectedWord(serverMs: number, releaseMs: number, timeZone: string): string {
  return trainingDay(serverMs, timeZone) === trainingDay(releaseMs, timeZone) ? "today" : "tomorrow";
}

describe("anchoredNow", () => {
  it("is the server's instant plus the device's elapsed time, whatever the device's own date", () => {
    const server = Date.parse("2026-11-10T12:00:00Z");
    for (const device of [Date.parse("2026-11-14T17:41:00Z"), Date.parse("2026-11-01T00:00:00Z"), server]) {
      assert.equal(anchoredNow(server, device, device), server);
      assert.equal(anchoredNow(server, device, device + 90_000), server + 90_000);
    }
  });
});

describe("dayWord on the page's clock: every hour of a day, several zones, any device clock", () => {
  const DEVICE_OFFSETS = [-3 * DAY, -5 * HOUR, 0, 7 * 60_000, 5 * HOUR, 3 * DAY];
  const CI_RUNNER = Date.parse("2026-11-14T17:41:00Z");
  for (const zone of ZONES) {
    it(`${zone}: the server's word for the next 08:00 release`, () => {
      // Tuesday 2026-11-10 00:00 UTC, then every hour for a day; plus the zone's own 00:00, 04:00 and 08:00.
      const base = Date.parse("2026-11-10T00:00:00Z");
      const instants = Array.from({ length: 24 }, (_, h) => base + h * HOUR);
      for (const h of [0, 4, 8]) {
        let t = base;
        while (localParts(t, zone).h !== h) t += 15 * 60_000;
        instants.push(t, t - 60_000);
      }
      for (const serverMs of instants) {
        const release = nextRelease(serverMs, zone);
        const want = expectedWord(serverMs, release, zone);
        for (const elapsed of [0, 30_000]) {
          const devices = [...DEVICE_OFFSETS.map((o) => serverMs + o), CI_RUNNER];
          for (const deviceAnchor of devices) {
            const now = anchoredNow(serverMs, deviceAnchor, deviceAnchor + elapsed);
            const at = new Date(release).toISOString();
            assert.equal(dayWord(at, now, zone, DAY_START), want, `${zone} server ${new Date(serverMs).toISOString()} device ${new Date(deviceAnchor).toISOString()} +${elapsed}`);
          }
        }
      }
    });
  }

  it("the device's own date would mislabel it (the bug): a device days ahead says today for tomorrow's batch", () => {
    const server = Date.parse("2026-11-10T12:00:00Z");
    const at = "2026-11-11T08:00:00.000Z";
    assert.equal(dayWord(at, server, "UTC", DAY_START), "tomorrow");
    assert.equal(dayWord(at, Date.parse("2026-11-14T17:41:00Z"), "UTC", DAY_START), "today");
  });
});

describe("between 00:00 and the 04:00 day start (browser pass D4): the training day's words", () => {
  const WINDOW_ZONES = ["Asia/Calcutta", "UTC", "America/New_York", "America/Los_Angeles", "Pacific/Auckland", "Europe/Berlin"] as const;
  for (const zone of WINDOW_ZONES) {
    it(`${zone}: at 00:00, 01:00, 02:00, 03:59 the 08:00 release that morning is "tomorrow"; from 04:00 it is "today"`, () => {
      // Sunday 2026-11-15 in the zone (the pass: ~01:00 Sunday IST, the hub header SATURDAY).
      let t = Date.parse("2026-11-14T00:00:00Z");
      while (!(localParts(t, zone).date === "2026-11-15" && localParts(t, zone).h === 0 && localParts(t, zone).m === 0)) t += 15 * 60_000;
      const release = nextRelease(t, zone);
      assert.equal(localParts(release, zone).date, "2026-11-15");
      const at = new Date(release).toISOString();
      for (const [offset, word] of [[0, "tomorrow"], [HOUR, "tomorrow"], [2 * HOUR, "tomorrow"], [4 * HOUR - 60_000, "tomorrow"], [4 * HOUR, "today"], [7 * HOUR, "today"]] as const) {
        assert.equal(dayWord(at, t + offset, zone, DAY_START), word, `${zone} +${offset / 60_000} min`);
      }
      // The day after next is the weekday, counted on training days too.
      const later = new Date(release + 2 * DAY).toISOString();
      assert.equal(dayWord(later, t + HOUR, zone, DAY_START), "Tuesday", "Tue 08:00 seen from Sat's training day (01:00 Sun)");
      // dayStartHour 0 is the calendar day (the old wording, kept for callers that mean the calendar).
      assert.equal(dayWord(at, t + HOUR, zone, 0), "today");
    });
  }
});
