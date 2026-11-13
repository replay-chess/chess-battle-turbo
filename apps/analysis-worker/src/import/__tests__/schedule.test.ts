// The worker's sync schedule (phase-04 plan §8.10, §12.1 `WK/src/import/__tests__/schedule.test.ts`): the function
// IMPORT_SYNC reschedules the `import:<id>` row with and the backstop compares against. It is the contract's
// `nextAutoSyncAt` (WK/src/import/schedule.ts re-exports it, so web, DB and worker agree); these cases pin what the
// worker relies on: the next local 03:00 across DST changes, the HH:05 UTC slot (one Neon wake per UTC hour, D4-27),
// the 12-hour floor after a sync, the deterministic per-account jitter, never in the past.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as contract from "@repo/contracts/internal/import-schedule";
import { AUTO_SYNC_MIN_GAP_MS, nextAutoSyncAt } from "../schedule";

const iso = (d: Date) => d.toISOString();
const at = (s: string) => new Date(s);
const HOUR = 3_600_000;

describe("nextAutoSyncAt (worker)", () => {
  it("is the contract's function (one schedule for web, DB and worker)", () => {
    assert.equal(nextAutoSyncAt, contract.nextAutoSyncAt);
    assert.equal(AUTO_SYNC_MIN_GAP_MS, 12 * HOUR);
  });

  it("Asia/Kolkata: 03:00 IST is 21:30Z the day before → the 21:05Z slot (account 0), 22:05Z with 45 min jitter", () => {
    assert.equal(iso(nextAutoSyncAt("Asia/Kolkata", at("2026-11-10T12:00:00Z"), null, 0n)), "2026-11-10T21:05:00.000Z");
    assert.equal(iso(nextAutoSyncAt("Asia/Kolkata", at("2026-11-10T12:00:00Z"), null, 45n)), "2026-11-10T22:05:00.000Z");
    // Just after today's slot passed: tomorrow's.
    assert.equal(iso(nextAutoSyncAt("Asia/Kolkata", at("2026-11-10T21:31:00Z"), null, 0n)), "2026-11-11T21:05:00.000Z");
  });

  it("Europe/London across the October change: 03:00 BST = 02:00Z, then 03:00 GMT = 03:00Z", () => {
    // 2026-10-25 01:00 GMT is when London falls back.
    assert.equal(iso(nextAutoSyncAt("Europe/London", at("2026-10-23T12:00:00Z"), null, 0n)), "2026-10-24T02:05:00.000Z");
    assert.equal(iso(nextAutoSyncAt("Europe/London", at("2026-10-24T12:00:00Z"), null, 0n)), "2026-10-25T03:05:00.000Z");
  });

  it("America/New_York on 2027-03-14 (spring forward): 03:00 EST = 08:00Z, then 03:00 EDT = 07:00Z", () => {
    assert.equal(iso(nextAutoSyncAt("America/New_York", at("2027-03-12T12:00:00Z"), null, 0n)), "2027-03-13T08:05:00.000Z");
    assert.equal(iso(nextAutoSyncAt("America/New_York", at("2027-03-13T12:00:00Z"), null, 0n)), "2027-03-14T07:05:00.000Z");
  });

  it("every slot is at minute 05 UTC, after now, within a day, and deterministic per account", () => {
    const zones = ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York", "Australia/Adelaide", "Asia/Kathmandu"];
    const now = at("2026-11-12T09:30:00Z");
    for (const tz of zones) {
      for (const id of [0n, 1n, 17n, 59n, 60n, 123456789n]) {
        const r = nextAutoSyncAt(tz, now, null, id);
        assert.equal(r.getUTCMinutes(), 5, `${tz} ${id}`);
        assert.equal(r.getUTCSeconds(), 0);
        assert.ok(r.getTime() > now.getTime() - HOUR, `${tz} ${id}: not in the past beyond the snap`);
        assert.ok(r.getTime() <= now.getTime() + 25 * HOUR, `${tz} ${id}: within a day`);
        assert.equal(iso(nextAutoSyncAt(tz, now, null, id)), iso(r), "deterministic");
      }
    }
    // Accounts 60 apart share a slot; the jitter spreads one hour.
    assert.equal(iso(nextAutoSyncAt("UTC", now, null, 3n)), iso(nextAutoSyncAt("UTC", now, null, 63n)));
  });

  it("the 12-hour floor after a sync (R-CC-05): never sooner than 12 h after lastSyncOkAt, within the next hour", () => {
    const now = at("2026-11-10T12:00:00Z");
    const last = at("2026-11-10T20:00:00Z");
    const r = nextAutoSyncAt("Asia/Kolkata", now, last, 0n);
    assert.ok(r.getTime() >= last.getTime() + AUTO_SYNC_MIN_GAP_MS);
    assert.ok(r.getTime() < last.getTime() + AUTO_SYNC_MIN_GAP_MS + HOUR);
    // An old sync leaves the slot alone.
    assert.equal(iso(nextAutoSyncAt("Asia/Kolkata", now, at("2026-11-01T00:00:00Z"), 0n)), "2026-11-10T21:05:00.000Z");
  });

  it("an unknown zone falls back to UTC instead of stopping the sync", () => {
    assert.equal(iso(nextAutoSyncAt("Mars/Olympus", at("2026-11-10T12:00:00Z"), null, 0n)), "2026-11-11T03:05:00.000Z");
  });
});
