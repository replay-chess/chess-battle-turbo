// release.ts: the next release and due snapping (phase-05 plan §8.4, §12.1).
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { nextRelease, releaseOnDay, skipUntil, snapDue } from "./release";
import { localDate } from "./tz";

const at = (s: string) => new Date(s);
const iso = (d: Date) => d.toISOString();

describe("nextRelease", () => {
  it("is today's 08:00 before it and tomorrow's from it on (strictly ahead)", () => {
    assert.equal(iso(nextRelease(at("2026-11-12T03:00:00Z"), "UTC", 8)), "2026-11-12T08:00:00.000Z");
    assert.equal(iso(nextRelease(at("2026-11-12T07:59:59.999Z"), "UTC", 8)), "2026-11-12T08:00:00.000Z");
    assert.equal(iso(nextRelease(at("2026-11-12T08:00:00Z"), "UTC", 8)), "2026-11-13T08:00:00.000Z");
    assert.equal(iso(nextRelease(at("2026-11-12T19:00:00Z"), "UTC", 8)), "2026-11-13T08:00:00.000Z");
  });

  it("matches the persona tool's probe", () => {
    assert.equal(iso(nextRelease(at("2026-11-12T03:00:00.000Z"), "UTC", 8)), "2026-11-12T08:00:00.000Z");
  });

  it("uses the member's zone and release hour", () => {
    // Kolkata 07:00 local (01:30Z) → 08:00 local = 02:30Z.
    assert.equal(iso(nextRelease(at("2026-11-12T01:30:00Z"), "Asia/Kolkata", 8)), "2026-11-12T02:30:00.000Z");
    // Kolkata 09:00 local → tomorrow 08:00 local.
    assert.equal(iso(nextRelease(at("2026-11-12T03:30:00Z"), "Asia/Kolkata", 8)), "2026-11-13T02:30:00.000Z");
    assert.equal(iso(nextRelease(at("2026-11-12T03:30:00Z"), "Asia/Kolkata", 10)), "2026-11-12T04:30:00.000Z");
    // New York across the fall-back night: Saturday 20:00 EDT → Sunday 08:00 EST (13:00Z).
    assert.equal(iso(nextRelease(at("2026-11-01T00:00:00Z"), "America/New_York", 8)), "2026-11-01T13:00:00.000Z");
    // London across the fall-back night: Saturday 22:00 BST → Sunday 08:00 GMT.
    assert.equal(iso(nextRelease(at("2026-10-24T21:00:00Z"), "Europe/London", 8)), "2026-10-25T08:00:00.000Z");
    // Lord Howe (+11 in November): 08:00 local is 21:00Z the day before.
    assert.equal(iso(nextRelease(at("2026-11-12T19:00:00Z"), "Australia/Lord_Howe", 8)), "2026-11-12T21:00:00.000Z");
    assert.equal(iso(nextRelease(at("2026-11-12T19:00:00Z"), "Pacific/Chatham", 8)), "2026-11-13T18:15:00.000Z");
    assert.equal(iso(nextRelease(at("2026-11-12T19:00:00Z"), "Etc/UTC", 8)), "2026-11-13T08:00:00.000Z");
  });

  it("is what Skip for today waits for", () => {
    assert.equal(iso(skipUntil(at("2026-11-12T19:00:00Z"), "UTC", 8)), "2026-11-13T08:00:00.000Z");
  });
});

describe("snapDue", () => {
  it("moves a day-or-longer interval to the release hour of the same local day", () => {
    const raw = at("2026-11-16T19:00:00Z");
    const snapped = snapDue(raw, 4, "UTC", 8);
    assert.equal(iso(snapped), "2026-11-16T08:00:00.000Z");
    assert.deepEqual(localDate(snapped, "UTC"), localDate(raw, "UTC"));
  });

  it("keeps the calendar day in the member's zone, not UTC's", () => {
    // 20:00Z on the 16th is 01:30 on the 17th in Kolkata: snaps to the 17th's 08:00 local (02:30Z).
    const raw = at("2026-11-16T20:00:00Z");
    const snapped = snapDue(raw, 2, "Asia/Kolkata", 8);
    assert.equal(iso(snapped), "2026-11-17T02:30:00.000Z");
    assert.deepEqual(localDate(snapped, "Asia/Kolkata"), localDate(raw, "Asia/Kolkata"));
  });

  it("leaves sub-day intervals (Again, learning steps) unsnapped", () => {
    const raw = at("2026-11-12T19:10:00Z");
    assert.equal(snapDue(raw, 0, "UTC", 8), raw);
  });

  it("snaps across a DST change to the new offset", () => {
    // A due date on London's fall-back day lands on 08:00 GMT.
    assert.equal(iso(releaseOnDay(at("2026-10-25T18:00:00Z"), "Europe/London", 8)), "2026-10-25T08:00:00.000Z");
    // The day after, 08:00 BST the day before was 07:00Z: the change is honoured.
    assert.equal(iso(releaseOnDay(at("2026-10-24T18:00:00Z"), "Europe/London", 8)), "2026-10-24T07:00:00.000Z");
  });
});
