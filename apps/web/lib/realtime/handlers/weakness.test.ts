// Phase-06 plan §5.5: `weakness:progress` patches the cached profile while it is not ready (never a fetch);
// `weakness:ready` refetches the profile, only marks today's plan and Home stale, and turns the Train dot on when the
// write bumped the version. Frames are the contract fixtures; the cached payloads are WP1's (the real buildPayload).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { homeFixture, trainTodayFixture } from "@repo/contracts/http/fixtures/p05";
import type { Badges } from "@repo/contracts/http/train";
import type { WeaknessPayload } from "@repo/contracts/http/weakness";
import { userEventFixtures } from "@repo/contracts/socket/fixtures/user";
import { weaknessPayloadFixture } from "@/components/train/weakness/__fixtures__/payloads";
import { qk } from "@/lib/api/keys";
import { applyWeaknessProgress, applyWeaknessReady, patchWeaknessBadges, withWeaknessReady } from "./weakness";

const fx = userEventFixtures();
const progressEv = fx["weakness:progress"] as Parameters<typeof applyWeaknessProgress>[1];
const readyEv = fx["weakness:ready"] as Parameters<typeof applyWeaknessReady>[1];

function seeded(p: WeaknessPayload) {
  const qc = new QueryClient();
  qc.setQueryData(qk.train.weakness(), p);
  qc.setQueryData<Badges>(qk.badges(), { bankDue: 0, trainDot: false });
  qc.setQueryData(qk.me(), { user: { ref: "cme" }, badges: { bankDue: 0, trainDot: false } });
  qc.setQueryData(qk.home(), homeFixture("populated"));
  qc.setQueryData(qk.train.today(), trainTodayFixture("default"));
  return qc;
}

describe("weakness realtime handlers", () => {
  it("progress: an insufficient or computing profile turns computing with the event's progress", () => {
    for (const state of ["insufficient", "computing"] as const) {
      const qc = seeded(weaknessPayloadFixture(state));
      assert.equal(applyWeaknessProgress(qc, { ...progressEv, pct: 42, analysed: 12, target: 60 }), true);
      const d = qc.getQueryData<WeaknessPayload>(qk.train.weakness())!;
      assert.equal(d.status, "computing");
      assert.equal(d.progress!.pct, 42);
      assert.equal(d.progress!.analysed, 12);
      assert.equal(d.progress!.steps.length, 4);
    }
  });

  it("progress: a ready profile and an empty cache are left alone", () => {
    const qc = seeded(weaknessPayloadFixture("ready"));
    const before = qc.getQueryData(qk.train.weakness());
    assert.equal(applyWeaknessProgress(qc, progressEv), false);
    assert.equal(qc.getQueryData(qk.train.weakness()), before);
    assert.equal(applyWeaknessProgress(new QueryClient(), progressEv), false);
  });

  it("ready: the profile is invalidated (refetch where shown), today and Home only go stale", () => {
    const qc = seeded(weaknessPayloadFixture("computing"));
    applyWeaknessReady(qc, { ...readyEv, bumped: false });
    assert.equal(qc.getQueryState(qk.train.weakness())!.isInvalidated, true);
    assert.equal(qc.getQueryState(qk.train.today())!.isInvalidated, true);
    assert.equal(qc.getQueryState(qk.home())!.isInvalidated, true);
    assert.equal(qc.getQueryState(qk.train.today())!.fetchStatus, "idle", "no refetch of the hub");
    assert.equal(qc.getQueryState(qk.home())!.fetchStatus, "idle", "no refetch of Home");
    assert.equal(qc.getQueryData<Badges>(qk.badges())!.weaknessReady, undefined, "not bumped: the dot stays off");
  });

  it("ready + bumped turns the Train dot on in the badge and the viewer payload; seen turns it off", () => {
    const qc = seeded(weaknessPayloadFixture("computing"));
    applyWeaknessReady(qc, { ...readyEv, bumped: true });
    assert.deepEqual(qc.getQueryData<Badges>(qk.badges()), { bankDue: 0, trainDot: true, weaknessReady: true });
    assert.deepEqual((qc.getQueryData(qk.me()) as { badges: Badges }).badges, { bankDue: 0, trainDot: true, weaknessReady: true });
    patchWeaknessBadges(qc, false);
    assert.deepEqual(qc.getQueryData<Badges>(qk.badges()), { bankDue: 0, trainDot: false, weaknessReady: false });
  });

  it("clearing the weakness dot keeps the bank's own dot", () => {
    assert.deepEqual(withWeaknessReady({ bankDue: 3, trainDot: true, weaknessReady: true }, false), { bankDue: 3, trainDot: true, weaknessReady: false });
    assert.deepEqual(withWeaknessReady({ bankDue: 0, trainDot: false }, true), { bankDue: 0, trainDot: true, weaknessReady: true });
  });
});
