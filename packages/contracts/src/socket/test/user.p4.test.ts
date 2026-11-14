// P4's additions to the socket protocol (phase-04 plan §7.6; api-perf AP-44): the import and entitlement events in the
// emit registry (user rooms only, no per-room seq, measured budgets, live in production), their caller allow-list
// (the worker emits import:*, only the web emits entitlement:changed), and the reuse of P3's games:changed.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INTERNAL_POLICY, kidMayEmit } from "../../internal/auth";
import { GamesChangedEvent } from "../analysis";
import { userEventFixtures, worstUserEventFixtures } from "../fixtures/user";
import { EMIT_EVENTS, emitEventFor, SERVER_EVENTS } from "../registry";
import {
  EntitlementChangedEvent,
  ImportFailedEvent,
  ImportProgressEvent,
  importFailedDedupeKey,
  importFinishedDedupeKey,
  USER_EVENT_BUDGETS,
  USER_EVENT_NAMES,
  USER_EVENTS,
} from "../user";

describe("P4 emit registry entries", () => {
  it("registers the four user events with their CT schema, user rooms only, no seq, the measured budget", () => {
    // P5 appended bank:due_changed and mistakes:added (test/user.p5.test.ts); P4's four stay registered.
    for (const name of ["entitlement:changed", "import:failed", "import:finished", "import:progress"]) {
      assert.ok((USER_EVENT_NAMES as string[]).includes(name), name);
    }
    for (const name of USER_EVENT_NAMES) {
      const spec = EMIT_EVENTS[name];
      assert.equal(spec.schema, USER_EVENTS[name], name);
      assert.deepEqual([...spec.to], ["user"], name);
      assert.equal(spec.seq, false, name);
      assert.equal(spec.budget, USER_EVENT_BUDGETS[name], name);
      assert.equal("devOnly" in spec, false, `${name} is live in production`);
      assert.ok(name in SERVER_EVENTS, name);
    }
  });

  it("parses the typical and worst fixtures in every environment; the worst case fits the budget", () => {
    const typical = userEventFixtures();
    const worst = worstUserEventFixtures();
    for (const name of USER_EVENT_NAMES) {
      for (const env of ["dev", "test", "production"]) {
        const r = emitEventFor(name, env);
        assert.ok(r.ok, `${name} in ${env}`);
        assert.equal(r.schema.safeParse(typical[name]).success, true, `${name} typical`);
        assert.equal(r.schema.safeParse(worst[name]).success, true, `${name} worst`);
      }
      const size = Buffer.byteLength(JSON.stringify(worst[name]), "utf8");
      assert.ok(size <= USER_EVENT_BUDGETS[name], `${name} worst ${size} B > ${USER_EVENT_BUDGETS[name]} B`);
      // The budget is measured, not padded: the worst case uses at least 70 % of it.
      assert.ok(size >= USER_EVENT_BUDGETS[name] * 0.7, `${name} budget ${USER_EVENT_BUDGETS[name]} B is loose for ${size} B`);
    }
    // §7.6: a typical progress frame is ≈ 125 B.
    assert.ok(JSON.stringify(typical["import:progress"]).length <= 160);
  });

  it("the worker emits import:* and games:changed but never entitlement:changed; the web emits all user events", () => {
    for (const name of ["import:progress", "import:finished", "import:failed", "games:changed"]) {
      assert.equal(kidMayEmit("wk", name), true, `wk → ${name}`);
    }
    assert.equal(kidMayEmit("wk", "entitlement:changed"), false, "a worker key cannot fake a membership");
    for (const name of USER_EVENT_NAMES) assert.equal(kidMayEmit("web", name), true, `web → ${name}`);
    for (const kid of ["ops", "ws", "webwk", "opswk"]) {
      for (const name of USER_EVENT_NAMES) assert.equal(kidMayEmit(kid, name), false, `${kid} → ${name}`);
    }
    assert.equal(INTERNAL_POLICY.web.events, "all");
  });

  it("imports reuse P3's games:changed ({v:1}, gameRef optional)", () => {
    assert.equal(GamesChangedEvent.safeParse({ v: 1 }).success, true);
    assert.equal(EMIT_EVENTS["games:changed"].schema, GamesChangedEvent);
  });

  it("rejects negative counters, unknown codes and a payload without v", () => {
    const ok = userEventFixtures()["import:progress"];
    assert.equal(ImportProgressEvent.safeParse({ ...ok, imported: -1 }).success, false);
    assert.equal(ImportProgressEvent.safeParse({ ...ok, phase: "writing" }).success, false);
    assert.equal(ImportProgressEvent.safeParse({ ...ok, v: undefined }).success, false);
    const failed = userEventFixtures()["import:failed"];
    assert.equal(ImportFailedEvent.safeParse({ ...failed, code: "token_revoked" }).success, false, "dropped with D4-21");
    const ent = userEventFixtures()["entitlement:changed"];
    assert.equal(EntitlementChangedEvent.safeParse({ ...ent, entitlement: { ...ent.entitlement, member: "yes" } }).success, false);
  });

  it("terminal events carry stable dedupe keys", () => {
    assert.equal(importFinishedDedupeKey("cm3p4r8un0001slzpimp4rtq1"), "import:finished:cm3p4r8un0001slzpimp4rtq1");
    assert.equal(importFailedDedupeKey("cm3p4r8un0001slzpimp4rtq1", 3), "import:failed:cm3p4r8un0001slzpimp4rtq1:3");
  });
});
