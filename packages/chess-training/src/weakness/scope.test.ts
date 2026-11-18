// Scope (phase-06 plan §8.2, §7.4.2 step 9, §12.1/§12.3): the default and stored scopes, `since` as local midnight
// of the first of the month, the ISO-week Monday in the member's zone (Sunday night / Monday morning in Asia/Kolkata
// and America/Los_Angeles), the exclusions, the 300 cap, and the clock edges equal to CA's.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLOCK_EDGES_MS as CA_EDGES, TIME_PRESSURE_MS as CA_TP } from "@repo/chess-analysis/clock";
import { gameInput } from "../../test/gen";
import { CLOCK_EDGES_MS, TIME_PRESSURE_MS } from "./constants";
import { countsForPlayMore, isInScope, resolveScope, scopeSince, selectScope, weekStartOf } from "./scope";

const NOW = new Date("2026-11-17T09:30:00.000Z");

describe("scope", () => {
  it("defaults to rapid + blitz, 6 months, 300 games; keeps a stored scope in canonical order", () => {
    assert.deepEqual(resolveScope(null), { timeClasses: ["RAPID", "BLITZ"], months: 6, maxGames: 300 });
    assert.deepEqual(resolveScope({ weaknessTimeClasses: [], weaknessMonths: 0 }), { timeClasses: ["RAPID", "BLITZ"], months: 6, maxGames: 300 });
    assert.deepEqual(resolveScope({ weaknessTimeClasses: ["BULLET", "BLITZ", "RAPID"], weaknessMonths: 12 }), { timeClasses: ["RAPID", "BLITZ", "BULLET"], months: 12, maxGames: 300 });
    assert.deepEqual(resolveScope({ weaknessTimeClasses: ["DAILY"], weaknessMonths: 4 }), { timeClasses: ["RAPID", "BLITZ"], months: 6, maxGames: 300 });
  });

  it("since = local midnight of the 1st, `months` months back", () => {
    assert.equal(scopeSince(NOW, "UTC", 6).toISOString(), "2026-05-01T00:00:00.000Z");
    assert.equal(scopeSince(NOW, "Asia/Kolkata", 6).toISOString(), "2026-04-30T18:30:00.000Z");
    assert.equal(scopeSince(NOW, "America/Los_Angeles", 12).toISOString(), "2025-11-01T07:00:00.000Z");
    assert.equal(scopeSince(new Date("2026-02-10T12:00:00Z"), "UTC", 3).toISOString(), "2025-11-01T00:00:00.000Z");
  });

  it("weekStart is the local Monday: Sunday night and Monday morning across zones", () => {
    // 2026-11-15 is a Sunday, 2026-11-16 a Monday.
    assert.equal(weekStartOf(new Date("2026-11-15T20:00:00Z"), "Asia/Kolkata"), "2026-11-16", "01:30 Monday in Kolkata");
    assert.equal(weekStartOf(new Date("2026-11-15T18:00:00Z"), "Asia/Kolkata"), "2026-11-09", "23:30 Sunday in Kolkata");
    assert.equal(weekStartOf(new Date("2026-11-16T07:30:00Z"), "America/Los_Angeles"), "2026-11-09", "23:30 Sunday in Los Angeles");
    assert.equal(weekStartOf(new Date("2026-11-16T08:30:00Z"), "America/Los_Angeles"), "2026-11-16", "00:30 Monday in Los Angeles");
    assert.equal(weekStartOf(new Date("2026-11-22T23:59:00Z"), "UTC"), "2026-11-16");
  });

  it("excludes bot games, BOT-titled imports, aborted, live, out-of-window and out-of-class games", () => {
    const scope = resolveScope(null);
    const since = scopeSince(NOW, "UTC", 6);
    const g = (o: Parameters<typeof gameInput>[0]) => gameInput(o);
    const at = new Date("2026-10-01T12:00:00Z");
    assert.equal(isInScope(g({ gameId: "1", color: "w", endedAt: at }), scope, since), true);
    assert.equal(isInScope(g({ gameId: "2", color: "w", endedAt: at, mode: "BOT", source: "REPLAY" }), scope, since), false);
    assert.equal(isInScope(g({ gameId: "3", color: "w", endedAt: at, mode: "LEGEND_BOT", source: "REPLAY" }), scope, since), false);
    assert.equal(isInScope(g({ gameId: "4", color: "w", endedAt: at, oppTitle: "BOT" }), scope, since), false);
    assert.equal(isInScope(g({ gameId: "5", color: "w", endedAt: at, oppTitle: "BOT", source: "REPLAY", mode: "ONLINE" }), scope, since), true, "a REPLAY opponent's title is not an import's");
    assert.equal(isInScope(g({ gameId: "6", color: "w", endedAt: at, result: "ABORTED" }), scope, since), false);
    assert.equal(isInScope(g({ gameId: "7", color: "w", endedAt: null }), scope, since), false);
    assert.equal(isInScope(g({ gameId: "8", color: "w", endedAt: new Date("2026-04-30T23:59:59Z") }), scope, since), false);
    assert.equal(isInScope(g({ gameId: "9", color: "w", endedAt: at, timeClass: "BULLET" }), scope, since), false);
    assert.equal(isInScope(g({ gameId: "10", color: "w", endedAt: at, timeClass: "DAILY" }), scope, since), false);
    assert.equal(isInScope(g({ gameId: "11", color: "w", endedAt: at, timeClass: null }), scope, since), false);
    const sel = selectScope([g({ gameId: "4", color: "w", endedAt: at, oppTitle: "BOT" }), g({ gameId: "1", color: "w", endedAt: at })], scope, since);
    assert.equal(sel.excludedBot, 1);
    assert.equal(sel.games.length, 1);
  });

  it("keeps the newest 300", () => {
    const many = Array.from({ length: 320 }, (_, i) => gameInput({ gameId: String(1 + i), color: "w", endedAt: new Date(NOW.getTime() - i * 3_600_000) }));
    const sel = selectScope(many.reverse(), resolveScope(null), scopeSince(NOW, "UTC", 6));
    assert.equal(sel.games.length, 300);
    assert.equal(sel.games[0]!.gameId, "1");
    assert.equal(sel.games[299]!.gameId, "300");
  });

  it("'play N more games here' counts friend, online and tournament games only", () => {
    assert.deepEqual((["FRIEND", "ONLINE", "TOURNAMENT", "BOT", "LEGEND_BOT", "IMPORTED"] as const).map(countsForPlayMore), [true, true, true, false, false, false]);
  });

  it("the clock edges equal CA/src/clock.ts (one bucketing for STATS_V1, ERROR_LOG_V1 and the tag)", () => {
    assert.deepEqual([...CLOCK_EDGES_MS], [...CA_EDGES]);
    assert.equal(TIME_PRESSURE_MS, CA_TP);
  });
});
