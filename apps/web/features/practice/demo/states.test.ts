import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PracticeContextDTO } from "@repo/contracts/http/practice";
import { endOf } from "../runner";
import { MATED_FEN, PRACTICE_DEMO_SOURCES, PRACTICE_DEMO_STATES, practiceDemoContext, practiceDemoEngine } from "./states";

describe("practice demo states", () => {
  it("every state × source (and stress) is a valid practice context", () => {
    for (const state of PRACTICE_DEMO_STATES)
      for (const source of PRACTICE_DEMO_SOURCES)
        for (const stress of [false, true]) {
          const r = PracticeContextDTO.safeParse(practiceDemoContext(state, source, stress));
          assert.equal(r.success, true, `${state}/${source}/${stress}`);
        }
  });

  it("over starts mated; loading and failed are forced", () => {
    assert.equal(endOf({ startFen: MATED_FEN, moves: [] })?.method, "checkmate");
    assert.deepEqual(practiceDemoEngine("engine_loading"), { status: "loading", pct: 34 });
    assert.deepEqual(practiceDemoEngine("engine_failed"), { status: "failed" });
    assert.equal(practiceDemoEngine("default"), null);
  });
});
