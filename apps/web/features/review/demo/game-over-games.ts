// The legend games behind /dev/ui/game-over's legend slots (phase-03 plan §4.7, §4.10; DR/V3GameOverLegend.dc.html
// `over_legend`: "Threefold repetition · move 17", ply 34). P2's demo games are standard games, so the legend block
// sat on a 4-move knight shuffle and contradicted its own table (round 2 of the UI review, FIX-2). These are games
// from Morphy's position (10.Nxb5 …) that the legend fixtures describe move for move:
//   LEGEND_DRAW_UCI      10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.Ba4 (left Morphy's 12.O-O-O) … 17.Bb5 Rc8, a draw by threefold
//                        repetition on Black's 17th move (the `diverged` and `facts_ready` summaries: 12.Ba4 vs
//                        O-O-O, then 13.Bb5, 14.Ba4; "Morphy won this; you drew.");
//   LEGEND_OPPONENT_UCI  10.Nxb5 cxb5 11.Bxb5+ Kd8 (the opponent left the line: Morphy's game had 11…Nbd7), then Black
//                        resigns after 12.O-O-O+ (MORPHY_OPPONENT_LEFT below).
import { FIXTURE_LEGEND_REF } from "@repo/contracts/http/fixtures/review";
import type { LegendSummaryDTO } from "@repo/contracts/http/review";
import { demoFixtureOf, type DemoFixture } from "@/features/game/demo/fixtures";
import { Harness } from "@repo/game-core/testing/harness";
import { liveInput, T0 } from "@repo/game-core/testing/scenarios";

export const LEGEND_DRAW_UCI = [
  "c3b5", "c6b5", "c4b5", "b8d7", "b5a4", "a8d8", "a4b5", "d8c8", "b5a4", "c8d8", "a4b5", "d8c8", "b5a4", "c8b8", "a4b5", "b8c8",
] as const;
export const LEGEND_OPPONENT_UCI = ["c3b5", "c6b5", "c4b5", "e8d8", "e1c1"] as const;

function playedFromLegend(moves: readonly string[], blackResigns: boolean): Harness {
  const g = new Harness(liveInput(), T0).joinAll();
  g.advance(1_000).command("w", { type: "ready", now: 0 }, "study:ready", { type: "ready", side: "w" });
  g.advance(1_000).command("b", { type: "ready", now: 0 }, "study:ready", { type: "ready", side: "b" });
  for (const uci of moves) g.advance(3_000).move(g.server.turn, uci);
  if (blackResigns) g.advance(2_000).command("b", { type: "confirmResign", now: 0 }, "game:resign", { type: "resign", side: "b" });
  return g;
}

/** The viewer (White) left Morphy's line at move 12 and the game was drawn by repetition at move 17. */
export function legendDrawGame(): DemoFixture {
  return demoFixtureOf(playedFromLegend(LEGEND_DRAW_UCI, false), "w", "over_threefold");
}

/** The opponent (Black) left Morphy's line at 11…Kd8; White won when Black resigned after 12.O-O-O+. */
export function legendOpponentLeftGame(): DemoFixture {
  return demoFixtureOf(playedFromLegend(LEGEND_OPPONENT_UCI, true), "w", "over_resign_win");
}

/** The legend summary of LEGEND_OPPONENT_UCI: Morphy's 11…Nbd7 against the game's 11…Kd8. */
export const MORPHY_OPPONENT_LEFT: LegendSummaryDTO = {
  status: "ready",
  legendName: "Morphy",
  legendResult: "white_won",
  matched: 2,
  compared: 2,
  divergence: { ply: 3, moveLabel: "11…", userSan: "Kd8", legendSan: "Nbd7", by: "opponent" },
  rows: [
    { n: "10.", yours: "Nxb5", legend: "Nxb5", mark: "match" },
    { n: "11.", yours: "Bxb5+", legend: "Bxb5+", mark: "match" },
    { n: "12.", yours: "O-O-O+", legend: "O-O-O", mark: "none" },
  ],
  outcomeLine: "Morphy won this; you won.",
  compareHref: `/review/${FIXTURE_LEGEND_REF}/legend`,
  replayHref: null,
};
