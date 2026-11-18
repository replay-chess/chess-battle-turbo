// Property tests (phase-06 plan §12.1, TE P6; seeded mulberry32 in test/gen.ts, no new dependency), 500 random scopes
// each: adding an error with theme T never lowers T's rate; adding a game outside the scope never changes the
// in-scope numbers; the numbers are invariant to game order; deriveStatus is total over the full product of its inputs.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadBaseline } from "../../baselines/load";
import { err, gameInput, int, mulberry32, randomGames } from "../../test/gen";
import { aggregate, patternAgg, ratePer100 } from "./aggregate";
import { analysedOf, computeWeakness } from "./compute";
import { deriveStatus, type RecomputeState } from "./status";

const NOW = new Date("2026-11-16T10:00:00.000Z");
const RUNS = 500;
const baseline = loadBaseline("v0-synthetic");
const ctx = { now: NOW, timeZone: "UTC", profile: null, ratingBand: null } as const;

function shuffle<T>(xs: readonly T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

describe("weakness aggregation properties", () => {
  it("adding one error with theme T never lowers T's rate", () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const rnd = mulberry32(seed * 7919);
      const games = randomGames(seed, int(rnd, 1, 25), { now: NOW, analysedShare: 1 });
      const theme = ["fork", "pin", "hangingPiece", "skewer"][seed % 4]!;
      const before = aggregate(analysedOf(games));
      const extra = gameInput({ gameId: String(900_000 + seed), color: "w", endedAt: new Date(NOW.getTime() - 3_600_000), phaseMoves: [10, 20, 10], errors: [err([theme])] });
      // The extra error arrives in a new game with 40 moves; the rate is k/M, so compare with the same M.
      const withGame = aggregate(analysedOf([...games, gameInput({ ...extraSpec(seed), errors: [] })]));
      const after = aggregate(analysedOf([...games, extra]));
      assert.ok(ratePer100(patternAgg(after, theme).k, after.M) >= ratePer100(patternAgg(withGame, theme).k, withGame.M), `seed ${seed}`);
      assert.ok(patternAgg(after, theme).k === patternAgg(before, theme).k + 1, `seed ${seed}`);
    }
  });

  it("adding a game outside the scope never changes the in-scope numbers", () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const rnd = mulberry32(seed * 104729);
      const games = randomGames(seed + 10_000, int(rnd, 0, 30), { now: NOW });
      const base = computeWeakness(games, baseline, ctx);
      const outside = [
        gameInput({ gameId: String(800_000 + seed), color: "w", endedAt: new Date(NOW.getTime() - 400 * 86_400_000), errors: [err(["fork"])] }),
        gameInput({ gameId: String(810_000 + seed), color: "b", endedAt: NOW, mode: "BOT", source: "REPLAY", errors: [err(["fork"])] }),
        gameInput({ gameId: String(820_000 + seed), color: "w", endedAt: NOW, timeClass: "BULLET", errors: [err(["pin"])] }),
        gameInput({ gameId: String(830_000 + seed), color: "w", endedAt: NOW, result: "ABORTED", errors: [err(["pin"])] }),
      ][seed % 4]!;
      const more = computeWeakness([...games, outside], baseline, ctx);
      assert.deepEqual(JSON.parse(JSON.stringify(more)), JSON.parse(JSON.stringify(base)), `seed ${seed}`);
    }
  });

  it("the profile is invariant to the order of the games", () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const rnd = mulberry32(seed * 31);
      const games = randomGames(seed + 20_000, int(rnd, 0, 40), { now: NOW });
      const a = computeWeakness(games, baseline, ctx);
      const b = computeWeakness(shuffle(games, rnd), baseline, ctx);
      assert.deepEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)), `seed ${seed}`);
    }
  });

  it("deriveStatus is total over the product of its inputs and never returns undefined", () => {
    const snapshots = [null, { status: "READY" as const, gamesAnalysed: 20 }, { status: "INSUFFICIENT" as const, gamesAnalysed: 5 }, { status: "FAILED" as const, gamesAnalysed: 22 }];
    const recomputes: RecomputeState[] = ["none", "queued", "running"];
    let n = 0;
    for (const snapshot of snapshots)
      for (const recompute of recomputes)
        for (const lastJobFailed of [false, true])
          for (const importRunning of [false, true])
            for (const analysedInScope of [0, 4, 5, 19, 20, 25])
              for (const inScope of [0, 19, 20, 300]) {
                const r = deriveStatus({ snapshot, recompute, lastJobFailed, importRunning, analysedInScope, inScope, bulletGames: 30 });
                n += 1;
                assert.ok(["insufficient", "computing", "ready", "failed"].includes(r.status), JSON.stringify(r));
                assert.equal(typeof r.orphaned, "boolean");
                assert.equal(typeof r.offerBullet, "boolean");
                assert.ok(r.updating === null || (Number.isInteger(r.updating.newGames) && r.updating.newGames >= 0));
                if (snapshot?.status === "READY") assert.equal(r.status, "ready");
                if (r.orphaned) assert.equal(recompute, "none");
              }
    assert.equal(n, 4 * 3 * 2 * 2 * 6 * 4);
  });
});

function extraSpec(seed: number) {
  return { gameId: String(900_000 + seed), color: "w" as const, endedAt: new Date(NOW.getTime() - 3_600_000), phaseMoves: [10, 20, 10] as [number, number, number] };
}
