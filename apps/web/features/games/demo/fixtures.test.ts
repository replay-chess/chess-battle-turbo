import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GameRowDTO } from "@repo/contracts/http/games";
import { DEMO_STATES, demoPage, demoRows, isDemoState, rowMatches } from "./fixtures";

describe("/dev/ui/games fixtures", () => {
  it("every row is a valid G1 row with a unique ref, newest first", () => {
    for (const stress of [false, true]) {
      const rows = demoRows(stress);
      for (const r of rows) GameRowDTO.parse(r);
      assert.equal(new Set(rows.map((r) => r.ref)).size, rows.length);
      const times = rows.map((r) => Date.parse(r.playedAt));
      assert.deepEqual(times, [...times].sort((a, b) => b - a), `stress=${stress}`);
    }
    assert.equal(demoRows().length, 40);
    assert.equal(demoRows(true).length, 120);
    assert.ok(demoRows(true).every((r) => r.opponent.name.length === 20));
  });

  it("pages 30 at a time like G1", () => {
    const rows = demoRows();
    assert.deepEqual([demoPage(rows, {}, 1).rows.length, demoPage(rows, {}, 1).hasNext], [30, true]);
    assert.deepEqual([demoPage(rows, {}, 2).rows.length, demoPage(rows, {}, 2).hasNext], [40, false]);
    assert.equal(demoPage(rows, {}, 1).total, 40);
  });

  it("filters with the G1 rules (result, time class, moments, search over opponent / opening / position)", () => {
    const rows = demoRows();
    const loss = rows.find((r) => r.result === "loss" && r.tc.timeClass === "rapid")!;
    assert.ok(rowMatches(loss, { result: ["loss"], tc: ["rapid"] }));
    assert.ok(!rowMatches(loss, { result: ["win"] }));
    assert.ok(!rowMatches(loss, { tc: ["bullet"] }));
    const untimed = rows.find((r) => r.tc.timeClass === "untimed")!;
    assert.ok(!rowMatches(untimed, { tc: ["rapid", "blitz", "bullet", "classical"] }), "untimed only unfiltered");
    assert.ok(rowMatches(rows.find((r) => r.positionTitle)!, { q: "opera" }));
    assert.ok(rowMatches(rows.find((r) => r.opening?.name.startsWith("Two Knights"))!, { q: "two kn" }));
    assert.ok(rows.filter((r) => rowMatches(r, { moments: true })).every((r) => r.momentsCount > 0));
  });

  it("states", () => {
    assert.deepEqual([...DEMO_STATES], ["default", "filters_open", "empty", "loading", "error"]);
    assert.ok(isDemoState("empty"));
    assert.ok(!isDemoState("import_running"));
    assert.ok(!isDemoState(undefined));
  });
});
