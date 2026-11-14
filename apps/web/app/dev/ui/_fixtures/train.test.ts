// The P5 demo data (phase-05 plan §2.1, §4): every state of every demo route parses with its contract, and every line
// a demo plays is legal (the runner validates moves with chess.js, so an illegal fixture would show the broken-item
// path instead of the board state it names). The `broken` state is the one deliberate exception.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import { HomeData } from "@repo/contracts/http/home";
import { BankPage, SessionPayload, SessionSummary, TrainToday, type TrainItem } from "@repo/contracts/http/train";
import {
  BANK_DEMO_STATES,
  bankDemo,
  HOME_DEMO_STATES,
  homeDemo,
  HUB_DEMO_STATES,
  hubDemo,
  isStress,
  pickState,
  PUZZLE_DEMO_STATES,
  puzzlesDemo,
  RUNNER_DEMO_STATES,
  runnerDemo,
  SUMMARY_DEMO_STATES,
  summaryDemo,
  userMoves,
  type RunnerDemo,
} from "./train";

const parses = (schema: { safeParse(v: unknown): { success: boolean; error?: { message: string } } }, v: unknown, label: string) => {
  const r = schema.safeParse(v);
  assert.equal(r.success, true, `${label}: ${r.success ? "" : r.error?.message}`);
};

/** Plays setup + solution from the item's FEN; throws on the first illegal move. */
function playLine(item: TrainItem): void {
  const chess = new Chess(item.fen);
  for (const uci of [...item.setup, ...item.solution]) {
    const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    assert.ok(move, `${item.itemId}: ${uci} illegal`);
  }
}

/** The position before the user's first move (after the setup). */
function userStart(item: TrainItem): Chess {
  const chess = new Chess(item.fen);
  for (const uci of item.setup) chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return chess;
}

function legalFrom(chess: Chess, uci: string): boolean {
  try {
    return !!new Chess(chess.fen()).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return false;
  }
}

function checkRunner(demo: RunnerDemo, label: string, broken: boolean) {
  parses(SessionPayload, demo.payload, label);
  for (const item of demo.payload.items) {
    if (broken && item.itemId === "ibroken") {
      assert.throws(() => playLine(item), `${label}: the broken item is illegal on purpose`);
      continue;
    }
    playLine(item);
    const start = userStart(item);
    for (const alt of item.accept) assert.ok(legalFrom(start, alt), `${label} ${item.itemId}: accept ${alt}`);
    if (item.context) assert.ok(legalFrom(start, item.context.playedUci), `${label} ${item.itemId}: played ${item.context.playedUci}`);
  }
  const first = demo.payload.items[0];
  const firstMove = demo.script.find((s) => s.type === "move");
  if (first && firstMove && firstMove.type === "move" && !broken) {
    assert.ok(legalFrom(userStart(first), firstMove.uci), `${label}: the script's first move is legal`);
  }
}

describe("P5 demo data", () => {
  it("hub: every state (and stress) is a TrainToday; loading has no data", () => {
    for (const s of HUB_DEMO_STATES) {
      const d = hubDemo(s);
      if (s === "loading") assert.equal(d, null);
      else parses(TrainToday, d, `hub ${s}`);
    }
    parses(TrainToday, hubDemo("default", true), "hub stress");
  });

  it("bank: every state (and the 300-row stress bank) is a BankPage", () => {
    for (const s of BANK_DEMO_STATES) {
      const d = bankDemo(s);
      if (s === "loading") assert.equal(d, null);
      else parses(BankPage, d!.page, `bank ${s}`);
    }
    assert.equal(bankDemo("default", true)!.page.rows.length, 300);
    assert.equal(bankDemo("filtered")!.filter.theme, "fork");
  });

  it("runner (bank mode): every state parses, every line is legal, the script reaches the state", () => {
    for (const s of RUNNER_DEMO_STATES) checkRunner(runnerDemo(s), `runner ${s}`, s === "broken");
    checkRunner(runnerDemo("solve", true), "runner stress", false);
    assert.deepEqual(runnerDemo("wrong").script, [{ type: "move", uci: "b2b3" }], "the move the member played in the game");
    assert.deepEqual(runnerDemo("correct").script, [{ type: "move", uci: "d1c1" }, { type: "move", uci: "c1e3" }]);
    assert.equal(runnerDemo("review_position").payload.items[0]!.kind, "review_position");
    assert.ok(runnerDemo("saving").pendingOutbox! > 0);
  });

  it("puzzles: every state parses, setup + solution are legal (Lichess shape)", () => {
    for (const s of PUZZLE_DEMO_STATES) checkRunner(puzzlesDemo(s), `puzzles ${s}`, s === "broken");
    checkRunner(puzzlesDemo("solve", true), "puzzles stress", false);
    const first = puzzlesDemo("solve").payload.items[0]!;
    assert.equal(first.setup.length, 1);
    assert.deepEqual(userMoves(first), ["b5c7", "c7d5"]);
    assert.ok(puzzlesDemo("themes").payload.themes!.length >= 6);
  });

  it("summary and home: every state parses; saving has fewer server attempts than the client graded", () => {
    for (const s of SUMMARY_DEMO_STATES) parses(SessionSummary, summaryDemo(s).summary, `summary ${s}`);
    parses(SessionSummary, summaryDemo("default", true).summary, "summary stress");
    const saving = summaryDemo("saving");
    assert.ok(saving.clientGraded > saving.summary.graded);
    for (const s of HOME_DEMO_STATES) {
      const d = homeDemo(s);
      if (s === "loading") assert.equal(d, null);
      else parses(HomeData, d!.data, `home ${s}`);
    }
    assert.equal(homeDemo("payment_failed")!.shell.paymentFailed, true);
    assert.equal(homeDemo("trial")!.shell.trialDaysLeft, 5);
    parses(HomeData, homeDemo("populated", true)!.data, "home stress");
    const newStress = homeDemo("new_user", true)!.data;
    parses(HomeData, newStress, "home new_user stress");
    assert.equal(newStress.state, "new_user", "stress keeps the requested state");
    assert.ok(newStress.startHere, "the new-user page keeps its primary");
  });

  it("query helpers fail closed to the default state", () => {
    assert.equal(pickState(HUB_DEMO_STATES, "nothingdue"), "nothingdue");
    assert.equal(pickState(HUB_DEMO_STATES, "<script>"), "default");
    assert.equal(pickState(HUB_DEMO_STATES, ["partial", "x"]), "partial");
    assert.equal(pickState(HUB_DEMO_STATES, undefined), "default");
    assert.equal(isStress({ stress: "1" }), true);
    assert.equal(isStress({ stress: ["1"] }), true);
    assert.equal(isStress({}), false);
  });
});
