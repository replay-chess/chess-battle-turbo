import assert from "node:assert/strict";
import { test } from "node:test";
import { adjudicate, type AdjudicateInput } from "../src/adjudicate";
import { sanToUci } from "../src/rules/chess";
import { INITIAL_FEN } from "../src/constants";

const line = (fen: string, sans: string) => sanToUci(fen, sans.split(" "));
const input = (over: Partial<AdjudicateInput> & Pick<AdjudicateInput, "moves" | "claim">): AdjudicateInput => ({
  startFen: INITIAL_FEN,
  clocksMs: [],
  initialMs: 600_000,
  incMs: 0,
  humanSide: "w",
  ...over,
});

test("genuine endings on the board are accepted", () => {
  const mate = adjudicate(
    input({ moves: line(INITIAL_FEN, "e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#"), claim: { result: "w", method: "checkmate" } }),
  );
  assert.deepEqual(mate.ok && [mate.outcome, mate.method, mate.plies], ["WHITE", "checkmate", 7]);
  const staleFen = "6k1/8/5K2/8/8/8/5Q2/8 w - - 0 57";
  const stale = adjudicate(
    input({ startFen: staleFen, moves: line(staleFen, "Kg6 Kh8 Qf7"), claim: { result: "draw", method: "stalemate" } }),
  );
  assert.ok(stale.ok && stale.outcome === "DRAW");
  const three = adjudicate(
    input({
      moves: line(INITIAL_FEN, "Nf3 Nf6 Ng1 Ng8 Nf3 Nf6 Ng1 Ng8"),
      claim: { result: "draw", method: "threefold" },
    }),
  );
  assert.ok(three.ok);
  const fiftyFen = "8/8/4k3/8/8/4K3/8/R6r w - - 98 120";
  assert.ok(
    adjudicate(
      input({ startFen: fiftyFen, moves: line(fiftyFen, "Ra7 Rh2"), claim: { result: "draw", method: "fifty_move" } }),
    ).ok,
  );
  const insFen = "8/8/4k3/8/8/2K5/8/2r5 b - - 0 69";
  assert.ok(
    adjudicate(
      input({
        startFen: insFen,
        moves: line(insFen, "Rc2+ Kxc2"),
        claim: { result: "draw", method: "insufficient_material" },
      }),
    ).ok,
  );
});

test("a claimed mate that is not on the board → claim_mismatch", () => {
  const r = adjudicate(
    input({ moves: line(INITIAL_FEN, "e4 e5 Bc4 Nc6"), claim: { result: "w", method: "checkmate" } }),
  );
  assert.deepEqual(r.ok ? null : [r.code, r.reason], ["claim_mismatch", "board_mismatch"]);
  const wrongWinner = adjudicate(
    input({ moves: line(INITIAL_FEN, "e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#"), claim: { result: "b", method: "checkmate" } }),
  );
  assert.ok(!wrongWinner.ok && wrongWinner.code === "claim_mismatch");
  const resignAfterMate = adjudicate(
    input({ moves: line(INITIAL_FEN, "e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#"), claim: { result: "b", method: "resignation" } }),
  );
  assert.ok(!resignAfterMate.ok && resignAfterMate.code === "claim_mismatch");
});

test("moves after a terminal position → claim_mismatch", () => {
  const fen = "6k1/8/5K2/8/8/8/5Q2/8 w - - 0 57";
  // After Qf7 it is stalemate; nothing may follow (here the list is padded with a pseudo-continuation).
  const r = adjudicate(
    input({
      startFen: fen,
      moves: [...line(fen, "Kg6 Kh8 Qf7"), "h8g8"],
      claim: { result: "b", method: "resignation" },
    }),
  );
  assert.ok(!r.ok && r.code === "claim_mismatch" && r.reason === "terminal_before_end");
});

test("an illegal move → illegal_moves", () => {
  const r = adjudicate(input({ moves: ["e2e4", "e7e5", "e1e3"], claim: { result: "b", method: "resignation" } }));
  assert.deepEqual(r.ok ? null : [r.code, r.ply], ["illegal_moves", 3]);
});

test("resignation: the human resigns, the bot never does", () => {
  const moves = line(INITIAL_FEN, "e4 e5 Nf3");
  assert.ok(adjudicate(input({ moves, claim: { result: "b", method: "resignation" } })).ok);
  const bot = adjudicate(input({ moves, claim: { result: "w", method: "resignation" } }));
  assert.ok(!bot.ok && bot.reason === "bot_resigned");
});

test("timeout: the side to move flags; impossible clocks → claim_mismatch", () => {
  const moves = line(INITIAL_FEN, "e4 e5 Nf3 Nc6");
  const clocks = [600_000, 600_000, 590_000, 580_000];
  const ok = adjudicate(
    input({ moves, clocksMs: clocks, claim: { result: "b", method: "timeout", flagRemainingMs: 0 } }),
  );
  assert.ok(ok.ok && ok.outcome === "BLACK");
  const wrongSide = adjudicate(input({ moves, clocksMs: clocks, claim: { result: "w", method: "timeout" } }));
  assert.ok(!wrongSide.ok);
  const grew = adjudicate(
    input({
      moves,
      incMs: 2_000,
      clocksMs: [600_000, 600_000, 605_000, 580_000],
      claim: { result: "b", method: "timeout" },
    }),
  );
  assert.ok(!grew.ok && grew.reason === "clock_increase");
  const range = adjudicate(
    input({ moves, clocksMs: [600_000, 600_000, -1, 580_000], claim: { result: "b", method: "timeout" } }),
  );
  assert.ok(!range.ok && range.reason === "clock_range");
  const length = adjudicate(input({ moves, clocksMs: [600_000], claim: { result: "b", method: "timeout" } }));
  assert.ok(!length.ok && length.reason === "clock_length");
  const notLow = adjudicate(
    input({ moves, clocksMs: clocks, claim: { result: "b", method: "timeout", flagRemainingMs: 5_000 } }),
  );
  assert.ok(!notLow.ok && notLow.reason === "timeout_clock");
  const untimed = adjudicate(input({ moves, initialMs: null, claim: { result: "b", method: "timeout" } }));
  assert.ok(!untimed.ok && untimed.reason === "untimed_timeout");
});

test("timeout vs insufficient must be claimed as the draw", () => {
  const fen = "7R/8/4k3/8/8/2K5/8/7r b - - 0 79";
  const moves = line(fen, "Rh2 Rxh2 Kd5"); // White to move flags; Black has only a king
  const r = adjudicate(
    input({ startFen: fen, humanSide: "w", moves, claim: { result: "draw", method: "timeout_vs_insufficient" } }),
  );
  assert.ok(r.ok && r.outcome === "DRAW");
  const asWin = adjudicate(input({ startFen: fen, humanSide: "w", moves, claim: { result: "b", method: "timeout" } }));
  assert.ok(!asWin.ok && asWin.reason === "board_mismatch");
});

test("agreement needs two plies; aborted needs fewer than two", () => {
  assert.ok(
    adjudicate(input({ moves: line(INITIAL_FEN, "e4 e5"), claim: { result: "draw", method: "agreement" } })).ok,
  );
  const early = adjudicate(input({ moves: line(INITIAL_FEN, "e4"), claim: { result: "draw", method: "agreement" } }));
  assert.ok(!early.ok && early.reason === "too_few_plies");
  const ab = adjudicate(input({ moves: line(INITIAL_FEN, "e4"), claim: { result: "aborted", method: "aborted" } }));
  assert.ok(ab.ok && ab.outcome === "NONE" && ab.pgn === null);
  const late = adjudicate(
    input({ moves: line(INITIAL_FEN, "e4 e5"), claim: { result: "aborted", method: "aborted" } }),
  );
  assert.ok(!late.ok && late.code === "claim_mismatch");
  const abandoned = adjudicate(
    input({ moves: line(INITIAL_FEN, "e4 e5"), claim: { result: "b", method: "abandoned" } }),
  );
  assert.ok(!abandoned.ok && abandoned.reason === "not_claimable");
});

test("the PGN is built for the accepted result when asked", () => {
  const r = adjudicate(
    input({
      moves: line(INITIAL_FEN, "e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#"),
      claim: { result: "w", method: "checkmate" },
      pgn: { ref: "cbotgame000000000000000001", mode: "BOT", date: 0, white: "me", black: "Engine 1400" },
    }),
  );
  assert.ok(r.ok && r.pgn?.includes("4. Qxf7# 1-0"));
});

test("regression: FIX-A — a 'bot flagged' claim must fit the server's wall time (SEC-07, plan 8.16)", () => {
  const base = {
    startFen: INITIAL_FEN,
    moves: "e2e4 e7e5",
    clocksMs: [300_000, 300_000],
    initialMs: 300_000,
    incMs: 0,
    humanSide: "b" as const,
    claim: { result: "b" as const, method: "timeout" as const },
  };
  // No server wall time: refused (fail closed).
  const blind = adjudicate(base);
  assert.ok(!blind.ok && blind.reason === "timeout_clock");
  // 20 s after the start the bot cannot have used its 5 minutes.
  const early = adjudicate({ ...base, elapsedMs: 20_000 });
  assert.ok(!early.ok && early.reason === "timeout_clock");
  // After 5 minutes it can.
  const late = adjudicate({ ...base, elapsedMs: 300_500 });
  assert.ok(late.ok && late.method === "timeout" && late.winner === "b");
  // The human losing on time needs no wall-time check.
  const humanFlag = adjudicate({ ...base, moves: "e2e4", clocksMs: [300_000], claim: { result: "w", method: "timeout" } });
  assert.ok(humanFlag.ok && humanFlag.winner === "w");
});
