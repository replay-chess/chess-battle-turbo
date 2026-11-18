// P6 badges (phase-06 plan §7.1.5 ME-2, §8.16; WP7): the profile's weaknessVersion / lastWeaknessSeenVersion ride in the
// same one-statement facts; `weaknessReady` = flag on ∧ wv > ws and lights `trainDot`; with the flag off the badges in
// /api/me and R8 are P5's byte for byte; the /api/me growth stays inside P5's ≤ 100 B badge budget.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MeData } from "@repo/contracts/http/me";
import { Badges } from "@repo/contracts/http/train";
import { meDataOf } from "../auth/viewer-dto";
import { viewerFixture } from "../../test/helpers/route-harness";
import { badgeFactsSql, badgesFor, badgesFrom, getBadges, weaknessUnseen } from "./badges.server";

const NOW = new Date("2026-11-12T19:00:00.000Z");
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
const P = { cap: 10, npd: 5, dsh: 4 };

describe("P6 badges: weaknessReady", () => {
  it("the facts read the two version columns inside the profile object: still one scalar, no parameter of its own", () => {
    const sql = badgeFactsSql("u.id", "(now() AT TIME ZONE 'UTC')");
    assert.match(sql, /'wv', tp\."weaknessVersion", 'ws', tp\."lastWeaknessSeenVersion"\) FROM training_profiles tp WHERE tp\."userId" = u\.id/);
    assert.equal(sql.includes("$"), false);
    assert.equal((sql.match(/FROM training_profiles/g) ?? []).length, 1, "the profile is read once (its PK), as in P5");
  });

  it("wv > ws is a new profile; equal, lower, a missing profile or older facts without the keys are not", () => {
    assert.equal(weaknessUnseen({ p: { ...P, wv: 2, ws: 1 } }), true);
    assert.equal(weaknessUnseen({ p: { ...P, wv: 2, ws: 2 } }), false);
    assert.equal(weaknessUnseen({ p: { ...P, wv: 1, ws: 3 } }), false, "seen clamps never make it negative-ready");
    assert.equal(weaknessUnseen({ p: null }), false);
    assert.equal(weaknessUnseen({ p: P }), false);
    assert.equal(weaknessUnseen(null), false);
  });

  it("flag on: weaknessReady and trainDot ||= it; flag off (or unset): P5's shape exactly", () => {
    const ready = { r: 0, n: 0, p: { ...P, wv: 3, ws: 2 }, d: null };
    assert.deepEqual(badgesFrom(ready, "UTC", NOW, { weakness: true }), { bankDue: 0, trainDot: true, weaknessReady: true });
    assert.deepEqual(badgesFrom(ready, "UTC", NOW, { weakness: false }), { bankDue: 0, trainDot: false });
    assert.deepEqual(badgesFrom(ready, "UTC", NOW), { bankDue: 0, trainDot: false });
    const seenWithDue = { r: 4, n: 0, p: { ...P, wv: 3, ws: 3 }, d: null };
    assert.deepEqual(badgesFrom(seenWithDue, "UTC", NOW, { weakness: true }), { bankDue: 4, trainDot: true, weaknessReady: false });
    assert.deepEqual(badgesFrom(null, "UTC", NOW, { weakness: true }), { bankDue: 0, trainDot: false, weaknessReady: false });
    assert.deepEqual(badgesFrom(JSON.stringify(ready), "UTC", NOW, { weakness: true }).weaknessReady, true, "the json scalar may arrive as text");
    for (const b of [badgesFrom(ready, "UTC", NOW, { weakness: true }), badgesFrom(ready, "UTC", NOW)]) Badges.parse(b);
  });

  it("badgesFor: the one gate /api/me and R8 share", () => {
    const raw = { bankDue: 0, trainDot: false, weaknessReady: true };
    assert.deepEqual(badgesFor(raw, true), { bankDue: 0, trainDot: true, weaknessReady: true });
    assert.deepEqual(badgesFor(raw, false), { bankDue: 0, trainDot: false });
    // A P5 record (no weaknessReady key) keeps its own dot with the flag off.
    assert.deepEqual(badgesFor({ bankDue: 3, trainDot: true }, false), { bankDue: 3, trainDot: true });
  });

  it("/api/me: weaknessReady only with train and weakness on; off, the body equals P5's; growth ≤ 100 B", () => {
    const viewer = { ...viewerFixture({}), badges: { bankDue: 2, trainDot: true, weaknessReady: true } };
    const p5Viewer = { ...viewerFixture({}), badges: { bankDue: 2, trainDot: true } };
    const off = meDataOf(viewer, { train: true, weakness: false }, "build-1");
    assert.equal(JSON.stringify(off), JSON.stringify(meDataOf(p5Viewer, { train: true, weakness: false }, "build-1")), "byte-identical to P5");
    assert.deepEqual(off.badges, { bankDue: 2, trainDot: true });
    const on = meDataOf(viewer, { train: true, weakness: true }, "build-1");
    MeData.parse(on);
    assert.deepEqual(on.badges, { bankDue: 2, trainDot: true, weaknessReady: true });
    assert.equal("badges" in meDataOf(viewer, { train: false, weakness: true }, "build-1"), false, "no badges without train");
    const growth = bytes(on) - bytes({ ...on, badges: undefined });
    assert.ok(growth <= 100, `badges add ${growth} B`);
    // The dot only: nothing due, a new profile.
    const dotOnly = meDataOf({ ...viewerFixture({}), badges: { bankDue: 0, trainDot: false, weaknessReady: true } }, { train: true, weakness: true }, "b");
    assert.deepEqual(dotOnly.badges, { bankDue: 0, trainDot: true, weaknessReady: true });
  });

  it("R8 runs ONE statement and passes the flag through", async () => {
    const calls: string[] = [];
    const db = {
      $queryRawUnsafe: <T>(text: string) => {
        calls.push(text);
        return Promise.resolve([{ facts: { r: 1, n: 0, p: { ...P, wv: 1, ws: 0 }, d: null } }] as unknown as T);
      },
    };
    assert.deepEqual(await getBadges(db, { id: 7n, timeZone: "UTC" }, NOW, { weakness: true }), { bankDue: 1, trainDot: true, weaknessReady: true });
    assert.deepEqual(await getBadges(db, { id: 7n, timeZone: "UTC" }, NOW), { bankDue: 1, trainDot: true });
    assert.equal(calls.length, 2);
    assert.match(calls[0]!, /^SELECT \(SELECT json_build_object\(/);
  });
});
