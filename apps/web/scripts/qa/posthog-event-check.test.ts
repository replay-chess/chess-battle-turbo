import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hogql, parseArgs } from "./posthog-event-check";

describe("posthog-event-check (phase-03 plan §12.8, T22)", () => {
  it("builds the dev-only count query of the worker smoke", () => {
    const a = parseArgs(["--event", "analysis_ready", "--where", "properties.regrade = false AND properties.ms_from_game_end IS NULL"]);
    assert.equal(
      hogql(a),
      "SELECT count() FROM events WHERE event = 'analysis_ready' AND properties.app_env = 'dev' AND timestamp > now() - INTERVAL 30 MINUTE" +
        " AND (properties.regrade = false AND properties.ms_from_game_end IS NULL)",
    );
  });

  it("refuses other projects, odd event names and multi-statement conditions", () => {
    assert.throws(() => parseArgs(["--event", "analysis_ready", "--app-env", "production"]), /dev/);
    assert.throws(() => parseArgs(["--event", "Analysis Ready"]), /snake_case/);
    assert.throws(() => parseArgs(["--event", "x", "--where", "1=1; DROP"]), /one HogQL/);
    assert.throws(() => parseArgs(["--event", "x", "--timeout-sec", "0"]), /timeout/);
  });
});
