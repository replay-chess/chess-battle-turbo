// lib/accounts/preview.ts against the import fixtures: LookupData (D4-08 all-time total, the band headline, initials
// only), the five newest Chess.com games, the Lichess export lines.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { LookupData } from "@repo/contracts/http/accounts";
import { chessComRecent, lichessRecent, lookupDataOf, privateLookupData } from "./preview";

const require = createRequire(import.meta.url);
const read = (rel: string) => readFileSync(require.resolve(`@repo/chess-fixtures/import/${rel}`), "utf8");
const PROFILE = JSON.parse(read("chesscom/knightowl_88/profile.json"));
const STATS = JSON.parse(read("chesscom/knightowl_88/stats.json"));
const OCT = JSON.parse(read("chesscom/knightowl_88/2026-10.json"));
// The export fixture carries malformed lines on purpose (the ndjson parser counts them); keep the parsable ones.
const LINES = read("lichess/knightowl88/games.ndjson")
  .split(/\r?\n/)
  .flatMap((l) => {
    try {
      return l.trim() ? [JSON.parse(l)] : [];
    } catch {
      return [];
    }
  });

describe("lookupDataOf", () => {
  it("found: lower-case key, display spelling, ratings per pool, all-time rated total, a headline", () => {
    const d = LookupData.parse(lookupDataOf(PROFILE, STATS));
    assert.equal(d.status, "found");
    assert.equal(d.profile.username, PROFILE.username.toLowerCase());
    assert.equal(d.profile.displayUsername, PROFILE.username);
    const sum = ["chess_rapid", "chess_blitz", "chess_bullet", "chess_daily"].reduce(
      (n, k) => n + (STATS[k] ? STATS[k].record.win + STATS[k].record.loss + STATS[k].record.draw : 0),
      0,
    );
    assert.equal(d.totalRatedGames, sum);
    assert.ok(d.headline && d.ratings[d.headline.timeClass]?.rating === d.headline.rating);
  });

  it("no rated games → no_games with a null headline; private keeps the handle", () => {
    const empty = lookupDataOf(PROFILE, {});
    assert.deepEqual([empty.status, empty.totalRatedGames, empty.headline], ["no_games", 0, null]);
    const p = LookupData.parse(privateLookupData("Closed_One", null));
    assert.deepEqual([p.status, p.profile.username, p.profile.displayUsername], ["private", "closed_one", "Closed_One"]);
  });

  it("drops a non-https avatar and an odd country", () => {
    const d = lookupDataOf({ ...PROFILE, avatar: "http://x.test/a.png", country: "https://api.chess.com/pub/country/XXL" }, STATS);
    assert.equal(d.profile.avatarUrl, null);
    assert.equal(d.profile.countryCode, null);
  });
});

describe("recent games", () => {
  it("Chess.com: rated standard games of the member, newest first, at most 5", () => {
    const games = chessComRecent(OCT.games, PROFILE.username.toLowerCase(), 5);
    assert.ok(games.length > 0 && games.length <= 5);
    const t = games.map((g) => Date.parse(g.endedAt));
    assert.deepEqual([...t].sort((a, b) => b - a), t);
    for (const g of games) assert.ok(["bullet", "blitz", "rapid", "daily"].includes(g.timeClass));
    assert.deepEqual(chessComRecent([{ nope: 1 }], "x"), []);
  });

  it("Lichess: win / loss / draw from `winner`, the opponent's name and rating, speed → class", () => {
    const games = lichessRecent(LINES, "knightowl88", 5);
    assert.equal(games.length, Math.min(5, LINES.filter((l: { rated: boolean }) => l.rated).length));
    const first = games[0]!;
    assert.ok(["win", "loss", "draw"].includes(first.result));
    assert.ok(first.opponentName.length > 0);
    const line = { rated: true, variant: "standard", speed: "correspondence", lastMoveAt: 1, players: { white: { user: { id: "me", name: "Me" }, rating: 1 }, black: { user: { id: "op", name: "Op" }, rating: 2 } } };
    assert.deepEqual(lichessRecent([line], "me"), [{ result: "draw", opponentName: "Op", opponentRating: 2, openingName: null, timeClass: "daily", endedAt: new Date(1).toISOString() }]);
    assert.deepEqual(lichessRecent([{ ...line, variant: "chess960" }], "me"), []);
  });
});
