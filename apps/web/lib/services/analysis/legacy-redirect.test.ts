// The H3 legacy redirect target (phase-03 plan §7.2 R1, §11.2 404 masking).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, it } from "node:test";
import type { GamesDb } from "@/lib/games/snapshot.server";

// legacy-redirect.ts starts with `import "server-only"`, which only Next.js resolves: stub it before loading the module
// (the lib/billing/products.test.ts pattern).
const STUB = "data:text/javascript,export%20%7B%7D";
nodeModule.registerHooks({
  resolve: (specifier, context, next) =>
    specifier === "server-only" ? { url: STUB, shortCircuit: true } : next(specifier, context),
});
const { LEGACY_FALLBACK_PATH, legacyAnalysisTarget, legacyApiTarget, legacyTargetSql } = await import("./legacy-redirect");

const REF = "cm1abcdefghijklmnopqrstu";

/** A database where `played` lists the user ids that played REF, and REF is a legend game when `legend`. */
function fakeDb(opts: { exists: boolean; legend: boolean; played: bigint[] }) {
  const seen: { sql: string; values: unknown[] }[] = [];
  const db = {
    async $queryRaw(q: { sql: string; values: unknown[] }) {
      seen.push({ sql: q.sql, values: q.values });
      if (!opts.exists || q.values[q.values.length - 1] !== REF) return [];
      const joinsPlayer = /game_players/.test(q.sql);
      if (joinsPlayer && !opts.played.includes(q.values[0] as bigint)) return [];
      return [{ legend: opts.legend }];
    },
  } as unknown as GamesDb;
  return { db, seen };
}

describe("legacy /analysis redirect target", () => {
  it("a player goes to the review, or to the comparison for a legend game", async () => {
    const plain = fakeDb({ exists: true, legend: false, played: [7n] });
    assert.equal(await legacyAnalysisTarget(plain.db, REF, { id: 7n, role: "user" }), `/review/${REF}`);
    const legend = fakeDb({ exists: true, legend: true, played: [7n] });
    assert.equal(await legacyAnalysisTarget(legend.db, REF, { id: 7n, role: "user" }), `/review/${REF}/legend`);
  });

  // regression: legacy-redirect-reveals-games (FIX-2, review round 2). Any signed-in user could tell from the Location
  // header that a game existed, and that it was a legend game, for games they did not play.
  it("a game the viewer did not play lands where an unknown ref does, legend or not", async () => {
    for (const legend of [false, true]) {
      const f = fakeDb({ exists: true, legend, played: [7n] });
      assert.equal(await legacyAnalysisTarget(f.db, REF, { id: 8n, role: "user" }), LEGACY_FALLBACK_PATH);
      assert.match(f.seen[0]!.sql, /JOIN game_players gp ON gp\."gameId" = g\.id AND gp\."userId" = \?/);
    }
    const unknown = fakeDb({ exists: false, legend: false, played: [] });
    assert.equal(await legacyAnalysisTarget(unknown.db, REF, { id: 8n, role: "user" }), LEGACY_FALLBACK_PATH);
  });

  it("signed out or a malformed ref: the fallback, without a query", async () => {
    const f = fakeDb({ exists: true, legend: false, played: [7n] });
    assert.equal(await legacyAnalysisTarget(f.db, REF, null), LEGACY_FALLBACK_PATH);
    assert.equal(await legacyAnalysisTarget(f.db, "../x", { id: 7n, role: "user" }), LEGACY_FALLBACK_PATH);
    assert.equal(f.seen.length, 0);
  });

  it("an admin skips the player check (the old page let admins open any game)", async () => {
    const f = fakeDb({ exists: true, legend: true, played: [7n] });
    assert.equal(await legacyAnalysisTarget(f.db, REF, { id: 1n, role: "admin" }), `/review/${REF}/legend`);
    assert.doesNotMatch(legacyTargetSql(REF, { id: 1n, role: "admin" }).sql, /game_players/);
  });

  it("the API target keeps only a valid ref", () => {
    assert.equal(legacyApiTarget(REF), `/api/review/${REF}`);
    assert.equal(legacyApiTarget("a/b"), null);
  });
});
