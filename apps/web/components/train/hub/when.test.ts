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

/** "today" when the release falls on the server's local date, else "tomorrow" (it is always within a day). */
function expectedWord(serverMs: number, releaseMs: number, timeZone: string): string {
  return localParts(serverMs, timeZone).date === localParts(releaseMs, timeZone).date ? "today" : "tomorrow";
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
            assert.equal(dayWord(at, now, zone), want, `${zone} server ${new Date(serverMs).toISOString()} device ${new Date(deviceAnchor).toISOString()} +${elapsed}`);
          }
        }
      }
    });
  }

  it("the device's own date would mislabel it (the bug): a device days ahead says today for tomorrow's batch", () => {
    const server = Date.parse("2026-11-10T12:00:00Z");
    const at = "2026-11-11T08:00:00.000Z";
    assert.equal(dayWord(at, server, "UTC"), "tomorrow");
    assert.equal(dayWord(at, Date.parse("2026-11-14T17:41:00Z"), "UTC"), "today");
  });
});
