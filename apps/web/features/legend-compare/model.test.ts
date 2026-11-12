import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { legendCompareFixture, OPERA } from "@repo/contracts/http/fixtures/review";
import { LEGEND_COMPUTE_MAX_ATTEMPTS, legendComparePath } from "@repo/contracts/http/legend";
import { reviewClientEvents } from "@repo/analytics";
import {
  bucket10,
  COMPUTE_MAX_ATTEMPTS,
  canRetryCompute,
  clampPos,
  clock,
  compareBoard,
  compareLines,
  COMPARE_TABS,
  defaultPos,
  engineTerms,
  evalRow,
  initialView,
  lastPos,
  legendMovesLead,
  legendOutcome,
  lineForTab,
  lineFrames,
  moveLabelAt,
  needsCompute,
  openedFrom,
  posOfCell,
  practiceHref,
  practiceLead,
  tableRows,
  yourMovesLead,
  LEGEND_ARROW,
  YOUR_ARROW,
} from "./model";

const ready = () => legendCompareFixture({ status: "ready" });

describe("compare model: the two lines", () => {
  it("replays both lines from the legend position", () => {
    const dto = ready();
    const lines = compareLines(dto);
    assert.equal(lines.yours.length, OPERA.userUci.split(" ").length + 1);
    assert.equal(lines.legend.length, OPERA.legendUci.split(" ").length + 1);
    assert.equal(lines.yours[0]!.fen, lines.legend[0]!.fen);
    assert.equal(lines.yours[1]!.label, "10.Nxb5");
    assert.equal(lines.yours[2]!.label, "10…cxb5");
    assert.equal(lines.legend[lines.legend.length - 1]!.label, "17.Rd8#");
    assert.equal(compareLines(dto), lines, "memoised per payload");
  });

  it("the split position is the divergence fen, the same on both lines", () => {
    const dto = ready();
    const lines = compareLines(dto);
    const d = dto.divergence!;
    assert.equal(lines.yours[d.ply]!.fen, d.fenBefore);
    assert.equal(lines.legend[d.ply]!.fen, d.fenBefore);
    assert.equal(lines.yours[d.ply + 1]!.label, "12.Ba4");
    assert.equal(lines.legend[d.ply + 1]!.label, "12.O-O-O");
  });

  it("a move that does not replay ends the line there", () => {
    const frames = lineFrames(OPERA.startFen, "c3b5 c6b5 a1a8", OPERA.startPly);
    assert.equal(frames.length, 3);
    assert.equal(lineFrames("garbage", "e2e4", 0).length, 0);
  });

  it("move labels count from the start ply", () => {
    assert.equal(moveLabelAt(0, 18), "10.");
    assert.equal(moveLabelAt(1, 18), "10…");
    assert.equal(moveLabelAt(0, 19), "10…");
  });
});

describe("compare model: the view", () => {
  it("opens at the split with both arrows (grey yours, sky the legend's)", () => {
    const dto = ready();
    const lines = compareLines(dto);
    const view = initialView(dto, lines, {});
    assert.deepEqual(view, { tab: "explanation", line: "yours", pos: dto.divergence!.ply });
    const b = compareBoard(dto, lines, view);
    assert.equal(b.atSplit, true);
    assert.equal(b.fen, dto.divergence!.fenBefore);
    assert.deepEqual(b.arrows, [
      { from: "b5", to: "a4", color: YOUR_ARROW },
      { from: "e1", to: "c1", color: LEGEND_ARROW },
    ]);
    assert.match(b.label, /you played 12\.Ba4, Morphy played 12\.O-O-O/);
    assert.match(b.label, /grey arrow .* blue arrow/, "the arrows are named, colour is not the only cue");
  });

  it("?tab and ?ply from the URL, clamped to the line", () => {
    const dto = ready();
    const lines = compareLines(dto);
    assert.deepEqual(initialView(dto, lines, { tab: "legend_moves", ply: "7" }), { tab: "legend_moves", line: "legend", pos: 7 });
    assert.equal(initialView(dto, lines, { tab: "your_moves", ply: "999" }).pos, lastPos(lines, "yours"));
    assert.equal(initialView(dto, lines, { tab: "nope", ply: "-3" }).tab, "explanation");
    assert.equal(initialView(dto, lines, { ply: "-3" }).pos, defaultPos(dto, lines));
  });

  it("the tab picks the line; the others keep it", () => {
    assert.equal(lineForTab("your_moves", "legend"), "yours");
    assert.equal(lineForTab("legend_moves", "yours"), "legend");
    assert.equal(lineForTab("practice", "legend"), "legend");
    assert.equal(lineForTab("explanation", "yours"), "yours");
    assert.deepEqual(COMPARE_TABS, ["explanation", "your_moves", "legend_moves", "practice"]);
  });

  it("stepping off the split shows the line's own position, named", () => {
    const dto = ready();
    const lines = compareLines(dto);
    const b = compareBoard(dto, lines, { line: "legend", pos: dto.divergence!.ply + 1 });
    assert.equal(b.atSplit, false);
    assert.deepEqual(b.arrows, []);
    assert.equal(b.posLabel, "Move 12.O-O-O");
    assert.match(b.label, /in Morphy’s line/);
    assert.equal(clampPos(lines, "yours", -4), 0);
    assert.equal(compareBoard(dto, lines, { line: "yours", pos: 0 }).posLabel, "Start");
  });

  it("a followed game opens at the end of your line", () => {
    const dto = { ...ready(), divergence: null };
    const lines = compareLines(dto);
    assert.equal(defaultPos(dto, lines), lastPos(lines, "yours"));
  });
});

describe("compare model: tables", () => {
  it("cells map to the position after that move", () => {
    assert.equal(posOfCell("10.", "w", 18), 1);
    assert.equal(posOfCell("10.", "b", 18), 2);
    assert.equal(posOfCell("12.", "w", 18), 5);
  });

  it("the split divider sits above the divergence row on both tables", () => {
    const dto = ready();
    const yours = tableRows(dto.yourLine.rows, dto.startPly, dto.divergence);
    const legend = tableRows(dto.legendLine.rows, dto.startPly, dto.divergence);
    assert.deepEqual(
      yours.filter((r) => r.splitAbove).map((r) => r.n),
      ["12."],
    );
    assert.deepEqual(
      legend.filter((r) => r.splitAbove).map((r) => r.n),
      ["12."],
    );
    const split = yours.find((r) => r.n === "12.")!;
    assert.equal(split.mark, "split");
    assert.deepEqual(split.w, { san: "Ba4", pos: 5 });
    assert.equal(legend[legend.length - 1]!.b, null, "17.Rd8# ends the legend's game");
    assert.equal(tableRows(dto.yourLine.rows, dto.startPly, null).some((r) => r.splitAbove), false);
  });
});

describe("compare model: copy", () => {
  it("leads per tab", () => {
    const dto = ready();
    assert.equal(yourMovesLead(dto), "You left Morphy’s path on 12.Ba4. Morphy won this; you drew.");
    assert.equal(legendOutcome(dto), "won");
    assert.equal(legendMovesLead(dto), "Morphy won in 17 moves. Morphy’s moves are in blue and marked in the last column.");
    assert.deepEqual(practiceLead(dto), { lead: "Play on from move 12 against the engine and try Morphy’s move yourself.", moveNo: 12 });
    assert.equal(engineTerms(1400), "Engine 1400 · untimed · not rated");
    assert.equal(legendOutcome({ legendResult: "white_won", you: "b" }), "lost");
    assert.equal(legendOutcome({ legendResult: "draw", you: "w" }), "drew");
  });

  it("the practice link says it came from compare", () => {
    assert.equal(practiceHref(ready()), `/practice?game=${ready().ref}&ply=4&from=compare`);
  });

  it("the eval row: ready text, a pending ghost, nothing without your divergence", () => {
    assert.deepEqual(evalRow(ready()), { kind: "ready", text: "Win chances after the split: you 41% · Morphy 78%" });
    const pending = legendCompareFixture({ status: "facts_ready" });
    assert.equal(evalRow(pending).kind, "pending");
    assert.match((evalRow({ ...pending, analysisStatus: "running" }) as { text: string }).text, /analysis finishes/);
    assert.equal(evalRow({ ...ready(), divergence: null }).kind, "none");
    assert.equal(evalRow(legendCompareFixture({ status: "failed" })).kind, "none");
  });

  it("clock and buckets", () => {
    assert.equal(clock(51), "0:51");
    assert.equal(clock(130), "2:10");
    assert.equal(clock(-3), "0:00");
    assert.equal(bucket10(47.9), 40);
    assert.equal(bucket10(100), 100);
  });
});

describe("compare model: the one A9b", () => {
  it("only when your divergence's evals are missing, the analysis is done and attempts are left", () => {
    const pending = legendCompareFixture({ status: "facts_ready" });
    assert.equal(COMPUTE_MAX_ATTEMPTS, LEGEND_COMPUTE_MAX_ATTEMPTS);
    assert.equal(needsCompute(pending, COMPUTE_MAX_ATTEMPTS), true);
    assert.equal(needsCompute(ready(), COMPUTE_MAX_ATTEMPTS), false);
    assert.equal(needsCompute({ ...pending, analysisStatus: "running" }, COMPUTE_MAX_ATTEMPTS), false);
    assert.equal(needsCompute({ ...pending, attempts: 3 }, COMPUTE_MAX_ATTEMPTS), false);
    assert.equal(needsCompute({ ...pending, divergence: null }, COMPUTE_MAX_ATTEMPTS), false);
    assert.equal(needsCompute({ ...pending, divergence: { ...pending.divergence!, by: "opponent" } }, COMPUTE_MAX_ATTEMPTS), false);
    assert.equal(canRetryCompute({ status: "failed", attempts: 1 }, COMPUTE_MAX_ATTEMPTS), true);
    assert.equal(canRetryCompute({ status: "failed", attempts: 3 }, COMPUTE_MAX_ATTEMPTS), false);
  });
});

describe("compare telemetry", () => {
  it("legend_compare_opened.from from the link or the referrer", () => {
    assert.equal(openedFrom("archive", null), "archive");
    assert.equal(openedFrom(null, "/game/abc"), "game_over");
    assert.equal(openedFrom(null, "/games?sel=x"), "archive");
    assert.equal(openedFrom("evil", "/review/x"), "review_menu");
    for (const from of ["game_over", "archive", "review_menu"] as const) {
      assert.equal(reviewClientEvents.legend_compare_opened.safeParse({ from, status: "ready" }).success, true);
    }
  });

  it("the tab names are the registry's", () => {
    for (const tab of COMPARE_TABS) {
      assert.equal(reviewClientEvents.compare_tab_viewed.safeParse({ tab, comparison_status: "facts_ready" }).success, true);
    }
  });

  it("the page path is the contract's", () => {
    assert.equal(legendComparePath("abc"), "/review/abc/legend");
  });
});
