// The P4 source tab on G1 (phase-04 plan §4.11; interface-check §0.9): `?source=` parses into the filter, becomes
// one condition on the player row, joins the ETag hash only when set, and the counts statement adds the per-source
// counts, which reach `meta.counts` once the member has imported games.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GamesQuery } from "@repo/contracts/http/games";
import type { Prisma } from "@repo/db";
import type { GamesDb } from "@/lib/games/snapshot.server";
import { archiveEtag, archiveRequestOf, countsOf, listMyGames, parseGamesFilter } from "./archive";
import { archiveCountsSql, archivePageSql, filterConditions } from "./archive-sql";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const textOf = (sql: Prisma.Sql) => sql.strings.join("?").replace(/\s+/g, " ");
const req = (query: Record<string, string>) => archiveRequestOf(GamesQuery.parse(query));

describe("parsing", () => {
  it("G1 and the RSC read ?source= the same way", () => {
    assert.deepEqual(req({ source: "chesscom", result: "loss" }).filter, { result: ["loss"], source: "chesscom" });
    assert.deepEqual(req({}).filter, {});
    assert.throws(() => GamesQuery.parse({ source: "fide" }), "an unknown source is a 400 on G1");
    assert.deepEqual(parseGamesFilter({ source: "lichess", moments: "1" }), { moments: true, source: "lichess" });
    assert.deepEqual(parseGamesFilter({ source: "fide" }), {}, "the page drops an unknown tab");
  });
});

describe("statements", () => {
  it("the tab is one condition on game_players.source (the index prefix stays the keyset)", () => {
    const conds = filterConditions({ source: "lichess" });
    assert.equal(conds.length, 1);
    assert.match(textOf(conds[0]!), /gp\.source = \?::"GameSource"/);
    assert.deepEqual(conds[0]!.values, ["LICHESS"]);
    const page = archivePageSql(7n, { source: "chesscom", result: ["win"] }, null, 30);
    assert.match(textOf(page), /AND gp\.source = \?::"GameSource" AND gp\.result = ANY/);
    assert.ok(page.values.includes("CHESSCOM"));
    assert.doesNotMatch(textOf(archivePageSql(7n, {}, null, 30)), /gp\.source/);
  });

  it("the counts statement adds the three source counts in the same pass; filteredTotal follows the tab", () => {
    const sql = textOf(archiveCountsSql(7n, { source: "replay" }));
    assert.match(sql, /count\(\*\) FILTER \(WHERE gp\.source = \?::"GameSource"\)\)::int AS "filteredTotal"/);
    for (const s of ["REPLAY", "CHESSCOM", "LICHESS"]) assert.ok(sql.includes(`gp.source = '${s}'::"GameSource"`), s);
    assert.equal((sql.match(/FROM game_players gp/g) ?? []).length, 1);
  });
  it("regression: D6 — the counts read game_players alone; games is joined only for a search", () => {
    for (const filter of [{}, { source: "chesscom" as const }, { result: ["win" as const], tc: ["blitz" as const], moments: true }]) {
      assert.doesNotMatch(textOf(archiveCountsSql(7n, filter)), /JOIN games/, JSON.stringify(filter));
    }
    assert.match(textOf(archiveCountsSql(7n, { q: "sicilian" })), /JOIN games g ON g\.id = gp\."gameId"/);
  });
});

describe("meta.counts", () => {
  it("Replay-only stays P3's { all }; any imported game adds the three counts", () => {
    assert.deepEqual(countsOf({ filteredTotal: 3, all: 9 }), { all: 9 });
    assert.deepEqual(countsOf({ filteredTotal: 3, all: 9, replay: 9, chesscom: 0, lichess: 0 }), { all: 9 });
    assert.deepEqual(countsOf({ filteredTotal: 3, all: 12, replay: 4, chesscom: 6, lichess: 2 }), { all: 12, replay: 4, chesscom: 6, lichess: 2 });
  });

  it("listMyGames reads them from the counts row", async () => {
    const db: GamesDb = {
      $queryRaw: async <T>(sql: Prisma.Sql) =>
        (textOf(sql).includes("filteredTotal") ? [{ filteredTotal: 6, all: 12, replay: 4, chesscom: 6, lichess: 2 }] : []) as T,
      $executeRaw: async () => {
        throw new Error("the archive never writes");
      },
    };
    const out = await listMyGames(db, { id: 7n }, req({ source: "chesscom", limit: "0" }), NOW);
    assert.deepEqual(out.meta, { nextCursor: null, filteredTotal: 6, counts: { all: 12, replay: 4, chesscom: 6, lichess: 2 } });
  });
});

describe("ETag", () => {
  it("a tab changes the tag; no tab leaves P3's tag unchanged", () => {
    const all = archiveEtag(3, req({}), NOW);
    const cc = archiveEtag(3, req({ source: "chesscom" }), NOW);
    const li = archiveEtag(3, req({ source: "lichess" }), NOW);
    assert.notEqual(all, cc);
    assert.notEqual(cc, li);
    assert.equal(archiveEtag(3, req({ source: "chesscom" }), NOW), cc);
  });
});
