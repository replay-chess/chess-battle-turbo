// Home's pure parts (phase-05 plan §4.1, §7.3 HOME-1): the week's accessible name, the new member's legend position,
// Continue's choice of game. The DB batch is covered by test/api/home.contract.int.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HomeStartHere } from "@repo/contracts/http/home";
import { continueOf, OPERA_FEN, startHereOf, weekAria } from "./home.server";

const NOW = new Date("2026-11-12T19:00:00.000Z");

describe("Home", () => {
  it("the week's accessible name", () => {
    assert.equal(weekAria([false, false, false, false, false, false, false]), "No games yet this week");
    assert.equal(weekAria([true, true, true, true, false, false, false]), "Played Monday to Thursday this week");
    assert.equal(weekAria([false, false, true, false, false, false, false]), "Played Wednesday this week");
    assert.equal(weekAria([true, false, true, false, false, false, false]), "Played Monday and Wednesday this week");
  });

  it("the Opera Game is the new member's first legend position; any other featured position reads generically", () => {
    const opera = startHereOf({ ref: "cm0p3r4g4me001slzpoperapos", fen: OPERA_FEN, sideToMove: "w", whitePlayerName: "Paul Morphy", blackPlayerName: "Duke Karl", tournamentName: "Paris", moveNumber: 10, eventDate: null })!;
    HomeStartHere.parse(opera);
    assert.equal(opera.href, "/position/cm0p3r4g4me001slzpoperapos");
    assert.equal(opera.title, "Play Your First Legend Position");
    assert.equal(opera.ariaLabel, "Morphy's Opera Game, move 10. White to move.");
    const other = startHereOf({ ref: "cm0p3r4g4me002slzpotherpos", fen: "8/8/8/8/8/8/8/K6k b - - 0 1", sideToMove: "b", whitePlayerName: "Capablanca", blackPlayerName: "Lasker", tournamentName: null, moveNumber: null, eventDate: null })!;
    HomeStartHere.parse(other);
    assert.equal(other.orient, "b");
    assert.equal(startHereOf(undefined), null);
  });

  it("Continue prefers the newest analysed game with moments, then one being analysed, then the newest clean one", () => {
    const row = (ref: string, status: string, moments: number) => ({
      ref,
      color: "b",
      result: "WIN",
      endedAt: NOW,
      opponentName: "martin_k",
      opponentRating: null,
      momentsCount: moments,
      accuracy: null,
      analysisStatus: status,
      plyCount: 2,
      openingName: null,
      startingFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      startPly: 0,
      moves: "e2e4 e7e5",
      gradedPlies: null,
      totalPlies: null,
      kPly: moments > 0 ? 1 : null,
    });
    const rows = [row("caaaaaaaaaaaaaaaaaaaaaaaa", "DONE", 0), row("cbbbbbbbbbbbbbbbbbbbbbbbb", "RUNNING", 0), row("ccccccccccccccccccccccccc", "DONE", 2)];
    assert.equal(continueOf(rows, NOW, "UTC")!.gameRef, "ccccccccccccccccccccccccc");
    assert.equal(continueOf(rows.slice(0, 2), NOW, "UTC")!.kind, "analysing");
    assert.equal(continueOf(rows.slice(0, 1), NOW, "UTC")!.kind, "clean");
    assert.equal(continueOf(rows.slice(0, 1), NOW, "UTC")!.orient, "b");
  });
});
