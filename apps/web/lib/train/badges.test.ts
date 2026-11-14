// The badges in /api/me (phase-05 plan §7.3 R8, interface check §0.13): one statement's facts, the capped count, and
// the payload growth (≤ 100 B per §9.4; present only with the `train` flag).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MeData } from "@repo/contracts/http/me";
import { meDataOf } from "../auth/viewer-dto";
import { viewerFixture } from "../../test/helpers/route-harness";
import { badgeFactsSql, badgesFrom, dueSummarySql } from "./badges.server";

const NOW = new Date("2026-11-12T19:00:00.000Z");
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");

describe("badges", () => {
  it("the facts are one scalar subquery on the due index, the profile and the latest training day", () => {
    const sql = badgeFactsSql("u.id", "(now() AT TIME ZONE 'UTC')");
    assert.match(sql, /^\(SELECT json_build_object\(/);
    assert.match(sql, /FROM training_cards bc WHERE bc\."userId" = u\.id AND bc\.deck = 'BANK' AND bc\.due <= /);
    assert.match(sql, /ORDER BY td\.day DESC LIMIT 1/);
    assert.equal(sql.includes("$"), false, "no bind parameter of its own: the viewer statement keeps its one parameter");
  });

  it("the cap formula: due review first, new cards within newPerDay, all within today's remaining cap", () => {
    assert.equal(badgesFrom({ r: 2, n: 9, p: null, d: null }, "UTC", NOW).bankDue, 7, "2 review + 5 new");
    assert.equal(badgesFrom({ r: 30, n: 0, p: { cap: 15, npd: 5, dsh: 4 }, d: null }, "UTC", NOW).bankDue, 15);
    // 03:00 local is still yesterday's training day (day start 04:00): yesterday's counters apply.
    const early = new Date("2026-11-13T03:00:00.000Z");
    assert.equal(badgesFrom({ r: 12, n: 0, p: { cap: 10, npd: 5, dsh: 4 }, d: { day: "2026-11-12", br: 10, ni: 0 } }, "UTC", early).bankDue, 0);
    assert.equal(badgesFrom({ r: 12, n: 0, p: { cap: 10, npd: 5, dsh: 4 }, d: { day: "2026-11-12", br: 10, ni: 0 } }, "UTC", new Date("2026-11-13T05:00:00.000Z")).bankDue, 10);
  });

  it("FIX-2: after a zone change mid-day the badge keeps the pinned day's used cap (as the hub and W2 do)", () => {
    // The reviewer's probe: trained in Los Angeles on 2026-11-12 with the cap of 10 used; at 2026-11-13T05:00Z the zone
    // is Asia/Tokyo, whose natural day is already the 13th. The pinned day in progress is still the 12th.
    const now = new Date("2026-11-13T05:00:00.000Z");
    const facts = { r: 10, n: 0, p: { cap: 10, npd: 5, dsh: 4 }, d: { day: "2026-11-12", br: 10, ni: 0, tz: "America/Los_Angeles", dsh: 4 } };
    assert.deepEqual(badgesFrom(facts, "Asia/Tokyo", now), { bankDue: 0, trainDot: false });
    // The day ends where it began (LA's next 04:00 local): then the new zone's day starts with a fresh cap.
    assert.deepEqual(badgesFrom(facts, "Asia/Tokyo", new Date("2026-11-13T12:30:00.000Z")), { bankDue: 10, trainDot: true });
    // A row without a recorded zone (before m5b) falls back to the natural day.
    assert.equal(badgesFrom({ ...facts, d: { ...facts.d, tz: null, dsh: null } }, "Asia/Tokyo", now).bankDue, 10);
  });

  it("/api/me carries the badges only with `train` on, and they add ≤ 100 B", () => {
    const viewer = { ...viewerFixture({}), badges: { bankDue: 10, trainDot: true } };
    const off = meDataOf(viewer, { train: false }, "build-1");
    const on = meDataOf(viewer, { train: true }, "build-1");
    assert.equal("badges" in off, false);
    MeData.parse(on);
    assert.deepEqual(on.badges, { bankDue: 10, trainDot: true });
    const growth = bytes(on) - bytes({ ...on, badges: undefined });
    assert.ok(growth <= 100, `badges add ${growth} B`);
  });

  it("statement (a) binds the request clock and the next release, never now()", () => {
    const sql = dueSummarySql(1n, NOW, new Date("2026-11-13T08:00:00.000Z"));
    assert.equal(/\bnow\(\)/.test(sql.text), false);
    assert.ok(sql.values.includes(NOW.toISOString()));
  });
});
