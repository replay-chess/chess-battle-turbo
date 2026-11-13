// bench:import's argument parsing, budgets and the latency driver (the run itself needs a local Postgres: see the
// script's header; its recorded numbers are in the phase-04 hand-back).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Driver } from "../src/db/client";
import { BUDGET, latencyDriver, parseArgs } from "./bench-import";

describe("bench:import", () => {
  it("parses its arguments with the plan's defaults (200 ms RTT, 2,000 games, both providers)", () => {
    assert.deepEqual(parseArgs([]), { out: null, rttMs: 200, games: 2_000, only: null });
    assert.deepEqual(parseArgs(["--out", "r.json", "--rtt-ms", "0", "--games", "500", "--only", "lichess"]), {
      out: "r.json",
      rttMs: 0,
      games: 500,
      only: "lichess",
    });
    assert.throws(() => parseArgs(["--only", "fide"]), /chesscom or lichess/);
    assert.throws(() => parseArgs(["--games", "5"]), /100\.\.10000/);
    assert.throws(() => parseArgs(["--rtt-ms", "-1"]), /0\.\.2000/);
    assert.throws(() => parseArgs(["--bogus"]), /unknown argument/);
    assert.throws(() => parseArgs(["--out"]), /needs a value/);
  });

  it("holds the §9.7 budgets", () => {
    assert.deepEqual(BUDGET, { chesscomMs: 90_000, chesscomStatements: 41, lichessMs: 150_000, firstChunkMs: 15_000 });
  });

  it("the latency driver waits before every round trip and notes the first chunk statement", async () => {
    const calls: string[] = [];
    const inner: Driver = {
      run: async (ss) => {
        calls.push(ss.map((s) => s.text).join(";"));
        return ss.map(() => []);
      },
      close: async () => undefined,
    };
    const d = latencyDriver(inner, 20);
    const t0 = performance.now();
    await d.run([{ text: "SELECT 1", values: [] }], false);
    assert.ok(performance.now() - t0 >= 18);
    assert.equal(d.firstChunkAt, null);
    await d.run([{ text: "WITH g AS (SELECT * FROM jsonb_to_recordset($1))", values: [] }], false);
    assert.ok(d.firstChunkAt !== null);
    assert.equal(calls.length, 2);
  });
});
