// P6's additions to the socket protocol (phase-06 plan §7.3, §9.3; interface check §0.7): the two Weakness Profile
// user events in the emit registry (user rooms only, no seq, measured budgets), `z.object` (an older socket keeps a
// frame a newer worker sent with an extra field), the caller allow-list (`wk` emits `weakness:*`, the web everything)
// and the per-snapshot dedupe key.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kidMayEmit } from "../../internal/auth";
import { EmitBody } from "../internal";
import { USER_FIXTURE_SNAPSHOT_KEY, userEventFixtures, worstUserEventFixtures } from "../fixtures/user";
import { EMIT_EVENTS, emitEventFor, SERVER_EVENTS } from "../registry";
import {
  USER_EVENT_BUDGETS,
  USER_EVENTS,
  WEAKNESS_PROGRESS_MIN_GAP_MS,
  WEAKNESS_PROGRESS_STEP_PCT,
  WeaknessProgressEvent,
  WeaknessReadyEvent,
  weaknessReadyDedupeKey,
} from "../user";

const P6_EVENTS = ["weakness:progress", "weakness:ready"] as const;
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
const USER_REF = "cm1a7rt0q0002ls8d9x0k4vze";

describe("P6 emit registry entries", () => {
  it("registers weakness:progress and weakness:ready with their schema, user rooms only, no seq, live in production", () => {
    for (const name of P6_EVENTS) {
      const spec = EMIT_EVENTS[name];
      assert.equal(spec.schema, USER_EVENTS[name], name);
      assert.deepEqual([...spec.to], ["user"], name);
      assert.equal(spec.seq, false, name);
      assert.equal(spec.budget, USER_EVENT_BUDGETS[name], name);
      assert.equal("devOnly" in spec, false, name);
      assert.ok(name in SERVER_EVENTS, name);
    }
  });

  it("typical and worst fixtures parse in every environment; the measured budgets hold (progress within the plan's 180 B)", () => {
    const typical = userEventFixtures();
    const worst = worstUserEventFixtures();
    for (const name of P6_EVENTS) {
      for (const env of ["dev", "test", "production"]) {
        const r = emitEventFor(name, env);
        assert.ok(r.ok, `${name} in ${env}`);
        assert.equal(r.schema.safeParse(typical[name]).success, true, `${name} typical`);
        assert.equal(r.schema.safeParse(worst[name]).success, true, `${name} worst`);
      }
      const size = bytes(worst[name]);
      assert.ok(size <= USER_EVENT_BUDGETS[name], `${name} worst ${size} B > ${USER_EVENT_BUDGETS[name]} B`);
      assert.ok(size >= USER_EVENT_BUDGETS[name] * 0.7, `${name}: budget ${USER_EVENT_BUDGETS[name]} B is loose for ${size} B`);
    }
    assert.ok(USER_EVENT_BUDGETS["weakness:progress"] <= 180);
    // A typical READY frame stays inside the plan's 120 B.
    assert.ok(bytes(typical["weakness:ready"]) <= 120, `typical ready ${bytes(typical["weakness:ready"])} B`);
  });

  it("the worker and the web may emit both; nobody else", () => {
    for (const name of P6_EVENTS) {
      assert.equal(kidMayEmit("wk", name), true, `wk → ${name}`);
      assert.equal(kidMayEmit("web", name), true, `web → ${name}`);
      for (const kid of ["ops", "ws", "webwk", "opswk"]) assert.equal(kidMayEmit(kid, name), false, `${kid} → ${name}`);
    }
  });

  it("fits the /internal/emit body with the per-snapshot dedupe key", () => {
    const fixtures = userEventFixtures();
    for (const name of P6_EVENTS) {
      const body = {
        v: 1,
        targets: [{ userRef: USER_REF }],
        event: name,
        data: fixtures[name],
        ...(name === "weakness:ready" ? { dedupeKey: weaknessReadyDedupeKey(USER_REF, USER_FIXTURE_SNAPSHOT_KEY) } : {}),
      };
      assert.equal(EmitBody.safeParse(body).success, true, name);
    }
    assert.equal(weaknessReadyDedupeKey(USER_REF, "2026-11-16.mwkhre80"), `weakness:ready:${USER_REF}:2026-11-16.mwkhre80`);
  });

  it("keeps an unknown extra field from a newer worker (z.object), rejects broken frames", () => {
    const p = userEventFixtures()["weakness:progress"];
    const parsed = WeaknessProgressEvent.parse({ ...p, laneHint: 2 });
    assert.equal("laneHint" in parsed, false, "extra keys are stripped, not refused");
    assert.equal(WeaknessProgressEvent.safeParse({ ...p, pct: 101 }).success, false);
    assert.equal(WeaknessProgressEvent.safeParse({ ...p, step: "upload" }).success, false);
    assert.equal(WeaknessProgressEvent.safeParse({ ...p, etaSec: -1 }).success, false);
    assert.equal(WeaknessProgressEvent.safeParse({ ...p, etaSec: null, importDone: null, importTotal: null }).success, true);
    assert.equal(WeaknessProgressEvent.safeParse({ ...p, target: 0 }).success, false);
    const r = userEventFixtures()["weakness:ready"];
    assert.equal(WeaknessReadyEvent.safeParse({ ...r, status: "computing" }).success, false, "COMPUTING is never written");
    assert.equal(WeaknessReadyEvent.safeParse({ ...r, topLabel: null, bumped: false, status: "failed" }).success, true);
    assert.equal(WeaknessReadyEvent.safeParse({ ...r, snapshotKey: "" }).success, false);
    assert.equal(WeaknessReadyEvent.safeParse({ ...r, topLabel: "x".repeat(41) }).success, false);
  });

  it("the throttle constants are the plan's (≤ 1 per 10 s, or every 5 %)", () => {
    assert.equal(WEAKNESS_PROGRESS_MIN_GAP_MS, 10_000);
    assert.equal(WEAKNESS_PROGRESS_STEP_PCT, 5);
  });
});
