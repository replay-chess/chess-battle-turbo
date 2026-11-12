// The game-over demo's fixtures (/dev/ui/game-over, plan §4.10): the P2 card under each slot and the seeded review
// status tell one story. regression: game-over-demo-contradictions (FIX-1): the done slot cited move 19 under a 2-ply
// resignation, and the legend slot said "you drew" under "You won by checkmate".
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import { legendSummaryFixture, reviewStatusFixture } from "@repo/contracts/http/fixtures/review";
import { gameOverDemoFixture } from "./game-over-fixture";
import { MORPHY_OPPONENT_LEFT } from "./game-over-games";
import { fitStatusToGame, GAME_OVER_DEMO_BASE, GAME_OVER_DEMO_COACH, GAME_OVER_DEMO_SLOTS } from "./states";

function game(slot: (typeof GAME_OVER_DEMO_SLOTS)[number]) {
  const f = gameOverDemoFixture(slot, GAME_OVER_DEMO_BASE[slot]);
  const st = f.game.state;
  const chess = new Chess(st.startFen);
  const sans: { san: string; color: "w" | "b"; moveNo: number; before: string }[] = [];
  for (const uci of st.moves.trim().split(/\s+/).filter(Boolean)) {
    const before = chess.fen();
    const moveNo = Number(before.split(" ")[5]);
    const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    sans.push({ san: m.san, color: m.color, moveNo, before });
  }
  return { f, sans, you: st.you.role === "player" ? st.you.color : null, chess };
}

describe("game-over demo fixtures", () => {
  it("every slot's base game reaches its design state", () => {
    for (const slot of GAME_OVER_DEMO_SLOTS) assert.equal(game(slot).f.derived, GAME_OVER_DEMO_BASE[slot], slot);
  });

  it("the done coach line names the viewer's own move and a legal alternative, inside the game", () => {
    const { sans, you } = game("done");
    const [, n, played, alt] = GAME_OVER_DEMO_COACH.done.match(/move (\d+), when (\S+) missed (\S+)\.$/)!;
    const move = sans.find((m) => m.moveNo === Number(n) && m.color === you);
    assert.ok(move, `move ${n} of ${you}`);
    assert.equal(move.san, played);
    assert.ok(new Chess(move.before).moves().includes(alt!), `${alt} is legal there`);
  });

  it("the clean coach line names the viewer's sacrifice that forced mate", () => {
    const { sans, you, chess } = game("clean");
    const qb8 = sans.find((m) => m.san === "Qb8+");
    assert.ok(qb8 && qb8.color === you && qb8.moveNo === 16);
    assert.ok(chess.isCheckmate());
    assert.match(GAME_OVER_DEMO_COACH.clean, /16\.Qb8\+/);
  });

  it("the legend outcome agrees with the card: drew under a draw, won under a win", () => {
    for (const [slot, summary] of [
      ["legend", legendSummaryFixture("diverged")],
      ["legend_pending", legendSummaryFixture("facts_ready")],
      ["legend_followed", legendSummaryFixture("followed")],
      ["legend_opponent", MORPHY_OPPONENT_LEFT],
    ] as const) {
      const { f } = game(slot);
      const drew = /you drew/.test(summary.outcomeLine);
      assert.equal(f.derived, GAME_OVER_DEMO_BASE[slot], slot);
      assert.ok(drew ? f.derived === "over_threefold" : /^over_(checkmate|resign)_win$/.test(f.derived), slot);
    }
  });

  // regression: game-over-legend-demo-contradictions (FIX-2, review round 2). The legend slots sat on a 4-move knight
  // shuffle ("Threefold repetition · move 4") under a Morphy table for moves 10-14 and a coach line about move 19.
  it("every legend slot's table, divergence and coach line are moves of the game on screen", () => {
    for (const [slot, summary] of [
      ["legend", legendSummaryFixture("diverged")],
      ["legend_pending", legendSummaryFixture("facts_ready")],
      ["legend_followed", legendSummaryFixture("followed")],
      ["legend_opponent", MORPHY_OPPONENT_LEFT],
    ] as const) {
      const { sans, you } = game(slot);
      const at = (label: string, color: "w" | "b") => sans.find((m) => `${m.moveNo}.` === label && m.color === color);
      for (const row of summary.rows) {
        const mine = at(row.n, you!);
        assert.ok(mine, `${slot}: move ${row.n} is in the game`);
        assert.equal(mine.san, row.yours, `${slot}: ${row.n}`);
      }
      if (summary.divergence) {
        const n = summary.divergence.moveLabel.replace(/[.…]+$/, "");
        const by = summary.divergence.by === "user" ? you! : you === "w" ? "b" : "w";
        assert.equal(at(`${n}.`, by)?.san, summary.divergence.userSan, `${slot}: the divergence`);
      }
      const status = fitStatusToGame(slot, reviewStatusFixture("done"), sans.length);
      const coach = status.review.coachLine ?? "";
      const named = coach.match(/(?:move (\d+), when (\S+) |(\d+)\.(\S+?)[ .,])/);
      assert.ok(named, `${slot}: ${coach}`);
      const moveNo = Number(named[1] ?? named[3]);
      const san = (named[2] ?? named[4])!.replace(/[.,]$/, "");
      assert.equal(sans.find((m) => m.moveNo === moveNo && m.color === you)?.san, san, `${slot}: ${coach}`);
    }
    const draw = game("legend");
    assert.equal(draw.sans.length, 16, "10.Nxb5 … 17…Rc8 from Morphy's position (ply 18 to 33)");
    assert.ok(draw.chess.isThreefoldRepetition());
    assert.equal(draw.sans.at(-1)!.moveNo, 17);
  });

  it("the seeded status uses the game's own plies; skipped stays under the analysis minimum", () => {
    const { sans } = game("done");
    const done = fitStatusToGame("done", reviewStatusFixture("done"), sans.length);
    assert.equal(done.analysis.totalPlies, sans.length);
    assert.equal(done.analysis.gradedPlies, sans.length);
    const failed = fitStatusToGame("failed", reviewStatusFixture("failed"), sans.length);
    assert.ok(failed.analysis.failedAtPly! <= sans.length);
    assert.ok(game("skipped").sans.length < 6);
  });
});
