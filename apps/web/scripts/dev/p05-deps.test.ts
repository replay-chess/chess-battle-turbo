// The P5 persona tool's domain functions (scripts/dev/p05-deps.ts): loaded from their owners' modules and probed once,
// so a missing module or a changed signature stops a reset before it writes rows that disagree with the worker's.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadTrainingDeps, TRAINING_DEP_SOURCES } from "./p05-deps";

/** Stand-ins that keep the documented contracts (signatures.md §3). */
const good: Record<string, Record<string, unknown>> = {
  "@repo/chess-analysis/epd": { epdHash: (fen: string) => BigInt.asIntN(64, BigInt(fen.split(" ").slice(0, 4).join(" ").length) * 0x9e3779b97f4a7c15n) },
  "@repo/chess-training/items": { mistakeItemKey: (h: bigint) => `m_${BigInt.asUintN(64, h).toString(36)}` },
  "@repo/chess-training/day": {
    dayKey: (now: Date, _tz: string, start: number) => new Date(now.getTime() - start * 3_600_000).toISOString().slice(0, 10),
  },
  "@repo/chess-training/release": {
    nextRelease: (now: Date, _tz: string, hour: number) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));
      return d > now ? d : new Date(d.getTime() + 86_400_000);
    },
  },
  "@repo/chess-training/mastery": {
    masteryOf: (state: string, s: number) => (state !== "REVIEW" ? 0 : s < 4 ? 1 : s < 10 ? 2 : s < 30 ? 3 : s < 90 ? 4 : 5),
  },
};

const loader = (mods: Record<string, Record<string, unknown>>) => async (spec: string) => {
  const m = mods[spec];
  if (!m) throw new Error(`Cannot find module '${spec}'`);
  return m;
};

describe("loadTrainingDeps", () => {
  it("names one owner module per function", () => {
    assert.deepEqual(Object.keys(TRAINING_DEP_SOURCES).sort(), ["dayKey", "epdHash", "masteryOf", "mistakeItemKey", "nextRelease"]);
  });

  it("returns working functions when every module keeps its contract", async () => {
    const deps = await loadTrainingDeps(loader(good));
    assert.equal(typeof deps.epdHash("8/8/8/8/8/8/8/K6k w - - 0 1"), "bigint");
    assert.match(deps.mistakeItemKey(-5n), /^m_/);
  });

  it("refuses a missing module, a missing export and a changed signature", async () => {
    const without = { ...good };
    delete without["@repo/chess-training/items"];
    await assert.rejects(loadTrainingDeps(loader(without)), /cannot load @repo\/chess-training\/items/);
    await assert.rejects(loadTrainingDeps(loader({ ...good, "@repo/chess-training/day": { dayKeyOf: () => "x" } })), /does not export dayKey/);
    await assert.rejects(
      loadTrainingDeps(loader({ ...good, "@repo/chess-training/release": { nextRelease: () => ({ at: new Date() }) } })),
      /nextRelease: must return the next local 08:00 as a Date/,
    );
    await assert.rejects(
      loadTrainingDeps(loader({ ...good, "@repo/chess-analysis/epd": { epdHash: (fen: string) => BigInt([...fen].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1_000_000_007, 7)) } })),
      /epdHash: must ignore the move counters/,
    );
    await assert.rejects(
      loadTrainingDeps(loader({ ...good, "@repo/chess-training/items": { mistakeItemKey: () => "card-1" } })),
      /is not an m_ item key/,
    );
  });
});
