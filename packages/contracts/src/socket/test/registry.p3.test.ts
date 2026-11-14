// P3's additions to the socket protocol (phase-03 plan §5.11, §7.4; task E2/E3): the analysis events in the emit
// registry (user rooms only, no per-room seq, the measured budgets, allowed in production, worker-emittable),
// `game:result.review`, and `GET /internal/load`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INTERNAL_POLICY, kidMayCall, kidMayEmit } from "../../internal/auth";
import { ANALYSIS_EVENTS, ANALYSIS_EVENT_BUDGETS, ANALYSIS_EVENT_NAMES } from "../analysis";
import { GameResultEvent } from "../events";
import { analysisEventFixtures, worstAnalysisEventFixtures } from "../fixtures/analysis";
import { LoadResponse } from "../internal";
import { EMIT_EVENTS, emitEventFor, SERVER_EVENTS } from "../registry";

const REF = "cmwc9p8sjf72avcjm23o4v6rv";

describe("P3 emit registry entries", () => {
  it("every analysis event is registered with its CT schema, user rooms only, no seq, the measured budget", () => {
    for (const name of ANALYSIS_EVENT_NAMES) {
      const spec = EMIT_EVENTS[name];
      assert.ok(spec, name);
      assert.equal(spec.schema, ANALYSIS_EVENTS[name], `${name}: the schema from ./analysis.ts`);
      assert.deepEqual([...spec.to], ["user"], `${name}: user rooms only (private to the players)`);
      assert.equal(spec.seq, false, name);
      assert.equal(spec.budget, ANALYSIS_EVENT_BUDGETS[name], name);
      assert.equal("devOnly" in spec, false, `${name} is live in production`);
      assert.ok(name in SERVER_EVENTS, `${name} is a server event`);
    }
  });

  it("emitEventFor resolves them in every environment and parses the fixtures", () => {
    const typical = analysisEventFixtures();
    const worst = worstAnalysisEventFixtures();
    for (const name of ANALYSIS_EVENT_NAMES) {
      for (const env of ["dev", "production", "test"]) {
        const r = emitEventFor(name, env);
        assert.ok(r.ok, `${name} in ${env}`);
        assert.equal(r.schema.safeParse(typical[name]).success, true, `${name} typical`);
        assert.equal(r.schema.safeParse(worst[name]).success, true, `${name} worst`);
      }
      assert.ok(JSON.stringify(worst[name]).length <= EMIT_EVENTS[name].budget, `${name} worst case within budget`);
    }
  });

  it("the worker (wk) may emit exactly the registered analysis events, not test:echo; web may emit them too", () => {
    for (const name of ANALYSIS_EVENT_NAMES) {
      assert.equal(kidMayEmit("wk", name), true, `wk → ${name}`);
      assert.equal(kidMayEmit("web", name), true, `web → ${name}`);
      assert.equal(kidMayEmit("ops", name), false, `ops → ${name}`);
      assert.equal(kidMayEmit("ws", name), false, `ws → ${name} (the socket emits in-process)`);
    }
    assert.equal(kidMayEmit("wk", "test:echo"), false);
    // Every event wk may emit that is registered today is a P3 analysis-side event (§5.11 caller allow-list) or,
    // since P4, an `import:*` event (phase-04 §7.6; user.p4.test.ts covers those), and since P5 a Mistake Bank
    // event (`bank:*`, `mistakes:*`; phase-05 §7.4, user.p5.test.ts).
    const wkRegistered = Object.keys(EMIT_EVENTS).filter((n) => kidMayEmit("wk", n));
    const p4Import = Object.keys(EMIT_EVENTS).filter((n) => n.startsWith("import:"));
    const p5Bank = Object.keys(EMIT_EVENTS).filter((n) => n.startsWith("bank:") || n.startsWith("mistakes:"));
    assert.deepEqual(wkRegistered.sort(), [...ANALYSIS_EVENT_NAMES, ...p4Import, ...p5Bank].sort());
    assert.ok(wkRegistered.every((n) => /^(analysis|compare|import|bank|mistakes):|^games:changed$/.test(n)));
  });

  it("/internal/load is a wk path only", () => {
    assert.equal(kidMayCall("wk", "/internal/load"), true);
    for (const kid of ["web", "ops", "ws"]) assert.equal(kidMayCall(kid, "/internal/load"), false, kid);
    assert.ok(INTERNAL_POLICY.wk.paths.includes("/internal/load"));
  });
});

describe("game:result.review (CON 3.9)", () => {
  const base = { seq: 9, ref: REF, ratings: null, tournament: null };
  it("carries queued + an ETA or skipped; P2's {status: none} is gone", () => {
    assert.equal(GameResultEvent.safeParse({ ...base, review: { status: "queued", etaSec: 19 } }).success, true);
    assert.equal(GameResultEvent.safeParse({ ...base, review: { status: "skipped", etaSec: null } }).success, true);
    assert.equal(GameResultEvent.safeParse({ ...base, review: { status: "none" } }).success, false);
    assert.equal(GameResultEvent.safeParse({ ...base, review: { status: "queued" } }).success, false, "etaSec is required");
  });
});

describe("GET /internal/load", () => {
  it("parses the four gauges and rejects a negative lag or a fractional count", () => {
    assert.equal(LoadResponse.safeParse({ loopLagP99Ms: 12.5, liveGames: 3, sockets: 40, draining: false }).success, true);
    assert.equal(LoadResponse.safeParse({ loopLagP99Ms: -1, liveGames: 3, sockets: 40, draining: false }).success, false);
    assert.equal(LoadResponse.safeParse({ loopLagP99Ms: 1, liveGames: 1.5, sockets: 40, draining: false }).success, false);
    assert.equal(LoadResponse.safeParse({ loopLagP99Ms: 1, liveGames: 1, sockets: 40 }).success, false);
  });
});
