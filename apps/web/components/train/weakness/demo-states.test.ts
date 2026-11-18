// The demo route's state list matches WP1's fixture states, and every demo state builds a payload that parses with
// the TR-5 contract (normal, lesson, stress) and stays under 8 KB.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WEAKNESS_PAYLOAD_MAX_BYTES, WeaknessPayload } from "@repo/contracts/http/weakness";
import { WEAKNESS_FIXTURE_STATES } from "./__fixtures__/payloads";
import { WEAKNESS_FIXTURE_STATE_NAMES } from "./demo-state-names";
import { demoPayload, demoSelected, WEAKNESS_DEMO_STATES } from "./demo-states";
import { rowBySlug } from "./model";

describe("weakness demo states", () => {
  it("the fixture state names are WP1's", () => {
    assert.deepEqual([...WEAKNESS_FIXTURE_STATE_NAMES], [...WEAKNESS_FIXTURE_STATES]);
  });

  it("every demo state parses, stays under 8 KB, and a drill state selects a row of the profile", () => {
    for (const state of WEAKNESS_DEMO_STATES) {
      for (const o of [{}, { lesson: true }, { stress: true }]) {
        const p = demoPayload(state, o);
        const r = WeaknessPayload.safeParse(p);
        assert.equal(r.success, true, `${state} ${JSON.stringify(o)} ${JSON.stringify(r.error?.issues)}`);
        assert.ok(JSON.stringify(p).length < WEAKNESS_PAYLOAD_MAX_BYTES, state);
      }
      const p = demoPayload(state);
      const slug = demoSelected(state, p);
      if (state.startsWith("drill")) assert.ok(rowBySlug(p, slug), `${state} selects a row`);
      else assert.equal(slug, null);
    }
  });
});
