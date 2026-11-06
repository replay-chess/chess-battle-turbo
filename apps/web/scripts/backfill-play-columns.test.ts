import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertBackfillTarget,
  creatorColorOf,
  endMethodOf,
  modeOf,
  outcomeOf,
  planBackfill,
  replayHistory,
  type LegacyGame,
} from "./backfill-play-columns";

const INITIAL = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const BOT = 99n;

function legacy(over: Partial<LegacyGame> & { gameData: unknown }): LegacyGame {
  return {
    id: 1n,
    status: "COMPLETED",
    result: "CREATOR_WON",
    creatorId: 1n,
    opponentId: 2n,
    tournamentId: null,
    startingFen: INITIAL,
    initialTimeSeconds: 300,
    incrementSeconds: 3,
    creatorTimeRemaining: 120,
    opponentTimeRemaining: 90,
    completedAt: new Date(0),
    updatedAt: new Date(0),
    creatorName: "alice",
    opponentName: "bob",
    ...over,
  };
}

describe("backfill rules (plan 6.8)", () => {
  it("host allow-list: the dev endpoint or localhost only", () => {
    assert.equal(assertBackfillTarget("postgresql://u:p@localhost:5432/x"), "localhost");
    assert.equal(
      assertBackfillTarget("postgresql://u:p@ep-fancy-dust-b8b3dp81-pooler.c-14.us-east-1.aws.neon.tech/neondb"),
      "ep-fancy-dust-b8b3dp81-pooler.c-14.us-east-1.aws.neon.tech",
    );
    assert.throws(() => assertBackfillTarget("postgresql://u:p@ep-shiny-shape-x.us-east-1.aws.neon.tech/neondb"), /BACKFILL_ALLOWED_HOSTS/);
  });

  it("mode: AI → BOT, friend → FRIEND, quick → ONLINE, tournament or tournamentId → TOURNAMENT, unknown → FRIEND", () => {
    assert.equal(modeOf({ gameMode: "AI" }, null, false), "BOT");
    assert.equal(modeOf({ gameMode: "ai" }, null, false), "BOT");
    assert.equal(modeOf({}, null, true), "BOT");
    assert.equal(modeOf({ gameMode: "friend" }, null, false), "FRIEND");
    assert.equal(modeOf({ gameMode: "quick" }, null, false), "ONLINE");
    assert.equal(modeOf({ gameMode: "tournament" }, null, false), "TOURNAMENT");
    assert.equal(modeOf({ gameMode: "friend" }, 5n, false), "TOURNAMENT");
    assert.equal(modeOf({ gameMode: "weird" }, null, false), "FRIEND");
  });

  it("colours: AI playerColor; matchmaking/tournament creator = White; friend creatorColor or unknown", () => {
    assert.equal(creatorColorOf("BOT", { playerColor: "black" }), "b");
    assert.equal(creatorColorOf("ONLINE", {}), "w");
    assert.equal(creatorColorOf("TOURNAMENT", { creatorColor: "white" }), "w");
    assert.equal(creatorColorOf("FRIEND", { creatorColor: "black" }), "b");
    assert.equal(creatorColorOf("FRIEND", {}), null);
  });

  it("replays verbose, SAN and UCI entries; stops at the first illegal entry", () => {
    const r = replayHistory(INITIAL, { moveHistory: [{ from: "e2", to: "e4", san: "e4" }, "e5", "g1f3", "zz", "Nc6"] });
    assert.deepEqual(r.uci, ["e2e4", "e7e5", "g1f3"]);
    assert.equal(r.truncated, true);
  });

  it("appends the lost mating move (DB-03)", () => {
    // Fool's mate without the final Qh4#.
    const gd = {
      moveHistory: ["f2f3", "e7e5", "g2g4"],
      method: "checkmate",
      fen: "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3",
    };
    const r = replayHistory(INITIAL, gd);
    assert.equal(r.mateFixed, true);
    assert.deepEqual(r.uci.slice(-1), ["d8h4"]);
    assert.equal(endMethodOf("checkmate", r), "CHECKMATE");
  });

  it("draw_agreement on a threefold position becomes THREEFOLD (socket F-12)", () => {
    const shuffle = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"];
    const r = replayHistory(INITIAL, { moveHistory: shuffle });
    assert.equal(endMethodOf("draw_agreement", r), "THREEFOLD");
    assert.equal(endMethodOf("draw_agreement", replayHistory(INITIAL, { moveHistory: ["e2e4"] })), "AGREEMENT");
  });

  it("outcome follows the creator's colour", () => {
    assert.equal(outcomeOf("CREATOR_WON", "b"), "BLACK");
    assert.equal(outcomeOf("CREATOR_TIMEOUT", "b"), "WHITE");
    assert.equal(outcomeOf("DRAW", null), "DRAW");
    assert.equal(outcomeOf("CREATOR_WON", null), null);
  });

  it("plans a legacy bot game: bot side NULL with the Engine label, one game_players row", () => {
    const p = planBackfill(
      legacy({ opponentId: BOT, gameData: { gameMode: "AI", playerColor: "black", difficulty: "hard", moveHistory: ["e2e4", "e7e5"] } }),
      new Set([BOT]),
    );
    assert.equal(p.mode, "BOT");
    assert.deepEqual([p.whitePlayerId, p.blackPlayerId, p.botElo], [null, 1n, 1800]);
    assert.deepEqual([p.whiteName, p.whiteRating, p.blackName], ["Engine 1800", 1800, "alice"]);
    assert.equal(p.plyCount, 2);
    assert.equal(p.outcome, "BLACK");
    assert.deepEqual(
      p.players.map((x) => [x.userId, x.color, x.result, x.opponentName]),
      [[1n, "b", "WIN", "Engine 1800"]],
    );
    assert.equal(p.timeClass, "BLITZ");
    assert.equal(p.blackTimeMs, 120_000, "creator (Black) keeps the creator clock");
  });

  it("an unknown friend colour leaves both colours NULL, flags meta.colorUnknown and writes no game_players", () => {
    const p = planBackfill(legacy({ gameData: { gameMode: "friend", moveHistory: [] } }), new Set());
    assert.deepEqual([p.whitePlayerId, p.blackPlayerId, p.players.length], [null, null, 0]);
    assert.equal(p.meta.colorUnknown, true);
  });
});
