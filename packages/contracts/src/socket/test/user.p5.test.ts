// P5's additions to the socket protocol (phase-05 plan §7.1, §7.4, §9.4; interface check §0.4, §0.12): the two Mistake
// Bank user events in the emit registry (user rooms only, no seq, measured budgets ≤ 120 B), their caller allow-list
// (the worker emits `mistakes:*` and `bank:*`, the web everything), and the coalescing dedupe key.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kidMayEmit } from "../../internal/auth";
import { EmitBody } from "../internal";
import { userEventFixtures, worstUserEventFixtures } from "../fixtures/user";
import { EMIT_EVENTS, emitEventFor, SERVER_EVENTS } from "../registry";
import {
  BankAdded,
  BankDueChangedEvent,
  MISTAKES_ADDED_MIN_GAP_MS,
  MistakesAddedEvent,
  mistakesAddedDedupeKey,
  USER_EVENT_BUDGETS,
  USER_EVENTS,
} from "../user";

const P5_EVENTS = ["bank:due_changed", "mistakes:added"] as const;
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");

describe("P5 emit registry entries", () => {
  it("registers bank:due_changed and mistakes:added with their schema, user rooms only, no seq, live in production", () => {
    for (const name of P5_EVENTS) {
      const spec = EMIT_EVENTS[name];
      assert.equal(spec.schema, USER_EVENTS[name], name);
      assert.deepEqual([...spec.to], ["user"], name);
      assert.equal(spec.seq, false, name);
      assert.equal(spec.budget, USER_EVENT_BUDGETS[name], name);
      assert.equal("devOnly" in spec, false, name);
      assert.ok(name in SERVER_EVENTS, name);
    }
  });

  it("the typical and worst fixtures parse in every environment; the worst case is within the plan's 120 B", () => {
    const typical = userEventFixtures();
    const worst = worstUserEventFixtures();
    for (const name of P5_EVENTS) {
      for (const env of ["dev", "test", "production"]) {
        const r = emitEventFor(name, env);
        assert.ok(r.ok, `${name} in ${env}`);
        assert.equal(r.schema.safeParse(typical[name]).success, true, `${name} typical`);
        assert.equal(r.schema.safeParse(worst[name]).success, true, `${name} worst`);
      }
      assert.ok(USER_EVENT_BUDGETS[name] <= 120, `${name}: the plan's budget is 120 B`);
      const size = bytes(worst[name]);
      assert.ok(size <= USER_EVENT_BUDGETS[name], `${name} worst ${size} B > ${USER_EVENT_BUDGETS[name]} B`);
      assert.ok(size >= USER_EVENT_BUDGETS[name] * 0.7, `${name}: budget ${USER_EVENT_BUDGETS[name]} B is loose for ${size} B`);
    }
  });

  it("the worker may emit both (backfill path); the web may emit both; nobody else", () => {
    for (const name of P5_EVENTS) {
      assert.equal(kidMayEmit("wk", name), true, `wk → ${name}`);
      assert.equal(kidMayEmit("web", name), true, `web → ${name}`);
      for (const kid of ["ops", "ws", "webwk", "opswk"]) assert.equal(kidMayEmit(kid, name), false, `${kid} → ${name}`);
    }
  });

  it("fits the /internal/emit body with the coalescing dedupe key", () => {
    const fixtures = userEventFixtures();
    for (const name of P5_EVENTS) {
      const body = {
        v: 1,
        targets: [{ userRef: "cm1a7rt0q0002ls8d9x0k4vze" }],
        event: name,
        data: fixtures[name],
        dedupeKey: mistakesAddedDedupeKey("cm1a7rt0q0002ls8d9x0k4vze", Date.parse("2026-11-13T10:00:30.000Z")),
      };
      assert.equal(EmitBody.safeParse(body).success, true, name);
    }
  });

  it("rejects negative counters, a payload without v and a malformed nextAt", () => {
    const due = userEventFixtures()["bank:due_changed"];
    assert.equal(BankDueChangedEvent.safeParse({ ...due, bankDue: -1 }).success, false);
    assert.equal(BankDueChangedEvent.safeParse({ ...due, v: undefined }).success, false);
    assert.equal(BankDueChangedEvent.safeParse({ ...due, nextAt: "tomorrow" }).success, false);
    assert.equal(BankDueChangedEvent.safeParse({ ...due, nextAt: null }).success, true, "nothing scheduled");
    const added = userEventFixtures()["mistakes:added"];
    assert.equal(MistakesAddedEvent.safeParse({ ...added, cardsAdded: 1.5 }).success, false);
    assert.equal(MistakesAddedEvent.safeParse({ ...added, games: -1 }).success, false);
  });

  it("BankAdded is {count, plies ≤ 4}", () => {
    assert.equal(BankAdded.safeParse({ count: 2, plies: [24, 36] }).success, true);
    assert.equal(BankAdded.safeParse({ count: 2, plies: [1, 2, 3, 4, 5] }).success, false);
  });

  it("the coalescing key is per user and per minute", () => {
    const ref = "cm1a7rt0q0002ls8d9x0k4vze";
    const t = Date.parse("2026-11-13T10:00:00.000Z");
    assert.equal(mistakesAddedDedupeKey(ref, t), mistakesAddedDedupeKey(ref, t + 59_999));
    assert.notEqual(mistakesAddedDedupeKey(ref, t), mistakesAddedDedupeKey(ref, t + MISTAKES_ADDED_MIN_GAP_MS));
    assert.match(mistakesAddedDedupeKey(ref, t), /^mistakes:cm1a7rt0q0002ls8d9x0k4vze:\d+$/);
  });
});
