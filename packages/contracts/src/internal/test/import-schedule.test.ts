// Phase-04 plan §8.10 / §12.1 schedule cases on the contract copy (WK/src/import/schedule.ts re-exports it and keeps
// its own copy of these cases): the next local 03:00 in Asia/Kolkata, Europe/London across the October DST change,
// America/New_York across the 2027-03-14 change; the HH:05 UTC snap; the 12-hour floor; the deterministic jitter.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTO_SYNC_MIN_GAP_MS,
  addLocalDays,
  atLocalTime,
  backlogSlotAt,
  localParts,
  nextAutoSyncAt,
  snapToSyncMinute,
  syncJitterMinutes,
  zonedInstant,
  zoneOffsetMs,
} from "../import-schedule";

const iso = (d: Date) => d.toISOString();
const at = (s: string) => new Date(s);

describe("zone arithmetic", () => {
  it("offsets: Kolkata +5:30, London 0 / +1, New York −5 / −4", () => {
    assert.equal(zoneOffsetMs("Asia/Kolkata", Date.parse("2026-07-01T00:00:00Z")), 5.5 * 3_600_000);
    assert.equal(zoneOffsetMs("Europe/London", Date.parse("2026-01-15T12:00:00Z")), 0);
    assert.equal(zoneOffsetMs("Europe/London", Date.parse("2026-07-15T12:00:00Z")), 3_600_000);
    assert.equal(zoneOffsetMs("America/New_York", Date.parse("2027-03-13T12:00:00Z")), -5 * 3_600_000);
    assert.equal(zoneOffsetMs("America/New_York", Date.parse("2027-03-15T12:00:00Z")), -4 * 3_600_000);
  });

  it("03:00 local is DST-safe on both sides of a change", () => {
    // Europe/London falls back on 2026-10-25 at 02:00 BST → 01:00 GMT.
    assert.equal(iso(zonedInstant("Europe/London", 2026, 10, 24, 3, 0)), "2026-10-24T02:00:00.000Z");
    assert.equal(iso(zonedInstant("Europe/London", 2026, 10, 25, 3, 0)), "2026-10-25T03:00:00.000Z");
    // America/New_York springs forward on 2027-03-14 at 02:00 EST → 03:00 EDT.
    assert.equal(iso(zonedInstant("America/New_York", 2027, 3, 13, 3, 0)), "2027-03-13T08:00:00.000Z");
    assert.equal(iso(zonedInstant("America/New_York", 2027, 3, 14, 3, 0)), "2027-03-14T07:00:00.000Z");
  });

  it("gap and overlap follow Postgres AT TIME ZONE: a gap time moves forward, an ambiguous time takes the later instant", () => {
    // 02:30 on 2027-03-14 does not exist in New York: read with the EST offset → 07:30Z (03:30 EDT on the wall).
    assert.equal(iso(zonedInstant("America/New_York", 2027, 3, 14, 2, 30)), "2027-03-14T07:30:00.000Z");
    // 01:30 on 2026-11-01 exists twice in New York (EDT, then EST): the later is 06:30Z.
    assert.equal(iso(zonedInstant("America/New_York", 2026, 11, 1, 1, 30)), "2026-11-01T06:30:00.000Z");
  });

  it("atLocalTime / addLocalDays keep the wall clock across a change", () => {
    const sat = atLocalTime("Europe/London", at("2026-10-24T12:00:00Z"), 3, 0);
    assert.equal(iso(sat), "2026-10-24T02:00:00.000Z");
    assert.equal(iso(addLocalDays("Europe/London", sat, 1)), "2026-10-25T03:00:00.000Z");
    assert.deepEqual(localParts("Asia/Kolkata", at("2026-11-10T21:00:00Z")), { year: 2026, month: 11, day: 11, hour: 2, minute: 30, second: 0 });
  });
});

describe("nextAutoSyncAt (§8.10)", () => {
  it("Asia/Kolkata: the next 03:00 IST (21:30Z), plus the jitter, snapped to HH:05 UTC", () => {
    // 03:00 IST = 21:30Z the previous UTC day. Account 0 has no jitter: 21:30 → snapped to 21:05.
    assert.equal(iso(nextAutoSyncAt("Asia/Kolkata", at("2026-11-10T12:00:00Z"), null, 0n)), "2026-11-10T21:05:00.000Z");
    // Account 45: 21:30 + 45 min = 22:15 → 22:05.
    assert.equal(iso(nextAutoSyncAt("Asia/Kolkata", at("2026-11-10T12:00:00Z"), null, 45n)), "2026-11-10T22:05:00.000Z");
    // After today's 03:00 IST has passed (it is 04:00 IST), the next one is tomorrow's.
    assert.equal(iso(nextAutoSyncAt("Asia/Kolkata", at("2026-11-10T22:30:00Z"), null, 0n)), "2026-11-11T21:05:00.000Z");
  });

  it("Europe/London across the October change: Saturday 02:05Z, Sunday 03:05Z", () => {
    assert.equal(iso(nextAutoSyncAt("Europe/London", at("2026-10-23T12:00:00Z"), null, 0n)), "2026-10-24T02:05:00.000Z");
    assert.equal(iso(nextAutoSyncAt("Europe/London", at("2026-10-24T12:00:00Z"), null, 0n)), "2026-10-25T03:05:00.000Z");
  });

  it("America/New_York on 2027-03-14: 03:00 EDT is 07:00Z (one hour earlier in UTC than the day before)", () => {
    assert.equal(iso(nextAutoSyncAt("America/New_York", at("2027-03-12T12:00:00Z"), null, 0n)), "2027-03-13T08:05:00.000Z");
    assert.equal(iso(nextAutoSyncAt("America/New_York", at("2027-03-13T12:00:00Z"), null, 0n)), "2027-03-14T07:05:00.000Z");
  });

  it("every result sits at minute 05 of a UTC hour, within an hour after local 03:00 + jitter", () => {
    for (const tz of ["Asia/Kolkata", "Europe/London", "America/New_York", "Australia/Adelaide", "UTC"]) {
      for (let id = 0n; id < 60n; id += 7n) {
        const now = at("2026-11-10T12:34:56Z");
        const r = nextAutoSyncAt(tz, now, null, id);
        assert.equal(r.getUTCMinutes(), 5, `${tz} ${id}`);
        assert.equal(r.getUTCSeconds(), 0);
        assert.ok(r.getTime() > now.getTime() - 3_600_000, `${tz} ${id} not in the past`);
        const target = atLocalTime(tz, r, 3, 0).getTime() + syncJitterMinutes(id) * 60_000;
        assert.ok(Math.abs(r.getTime() - target) <= 3_600_000 + 5 * 60_000, `${tz} ${id}`);
      }
    }
  });

  it("the 12-hour floor after the last good sync wins over the slot", () => {
    const now = at("2026-11-10T12:00:00Z");
    const last = at("2026-11-10T20:00:00Z");
    const r = nextAutoSyncAt("Asia/Kolkata", now, last, 0n);
    // 20:00 + 12 h = 08:00, rounded up to the next HH:05 UTC: one Neon wake per hour (D4-27).
    assert.equal(iso(r), "2026-11-11T08:05:00.000Z");
    assert.ok(r.getTime() >= last.getTime() + AUTO_SYNC_MIN_GAP_MS);
    assert.equal(iso(nextAutoSyncAt("Asia/Kolkata", now, at("2026-11-10T19:05:00Z"), 0n)), "2026-11-11T07:05:00.000Z", "on the minute stays");
    // An old sync does not move the slot.
    assert.equal(iso(nextAutoSyncAt("Asia/Kolkata", now, at("2026-11-01T00:00:00Z"), 0n)), "2026-11-10T21:05:00.000Z");
  });

  it("the jitter is deterministic per account (id mod 60) and an unknown zone falls back to UTC", () => {
    assert.equal(syncJitterMinutes(0n), 0);
    assert.equal(syncJitterMinutes(61n), 1);
    assert.equal(syncJitterMinutes("119"), 59);
    const now = at("2026-11-10T12:00:00Z");
    assert.equal(iso(nextAutoSyncAt("Mars/Olympus", now, null, 0n)), iso(nextAutoSyncAt("UTC", now, null, 0n)));
    assert.equal(iso(nextAutoSyncAt("UTC", now, null, 0n)), "2026-11-11T03:05:00.000Z");
    assert.equal(iso(snapToSyncMinute(at("2026-11-10T21:59:59Z"))), "2026-11-10T21:05:00.000Z");
  });

  it("the backlog slot is the member's own daily slot without the floor", () => {
    const now = at("2026-11-10T12:00:00Z");
    assert.equal(iso(backlogSlotAt("Asia/Kolkata", now, 45n)), iso(nextAutoSyncAt("Asia/Kolkata", now, null, 45n)));
  });
});
