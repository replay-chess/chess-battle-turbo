import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import { buildPgn, formatClk, terminationOf } from "../src/pgn";
import { sanToUci } from "../src/rules/chess";
import { INITIAL_FEN } from "../src/constants";

const OPERA =
  "e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#".split(
    " ",
  );
const uci = sanToUci(INITIAL_FEN, OPERA);
const clocks = uci.map((_, i) => 300_000 - i * 1_234);
const base = {
  ref: "cm3k8r2p0000qwerty1234567",
  mode: "FRIEND" as const,
  date: Date.UTC(2026, 10, 20, 18, 0),
  white: "knightowl_88",
  black: "martin_k",
  tc: { initialMs: 300_000, incrementMs: 3_000 },
};

test("round trip through chess.js loadPgn reproduces the moves and the final FEN", () => {
  const pgn = buildPgn({
    ...base,
    startFen: INITIAL_FEN,
    moves: uci,
    clocksMs: clocks,
    result: { winner: "w", method: "checkmate" },
  });
  const c = new Chess();
  c.loadPgn(pgn);
  assert.deepEqual(c.history(), OPERA);
  assert.ok(c.isCheckmate());
  const h = c.getHeaders();
  assert.equal(h.Result, "1-0");
  assert.equal(h.TimeControl, "300+3");
  assert.equal(h.Termination, "Normal");
  assert.equal(h.Event, "Replay Chess · Friend game");
  assert.equal(h.Site, "https://playchess.tech/game/cm3k8r2p0000qwerty1234567");
  assert.equal(h.Date, "2026.11.20");
  assert.equal(h.SetUp, undefined);
  const flat = pgn.replace(/\s+/g, " ");
  assert.match(flat, /1\. e4 \{\[%clk 0:05:00\.0\]\} 1\.\.\. e5 \{\[%clk 0:04:58\.7\]\}/);
  assert.match(flat, /17\. Rd8# \{\[%clk [^\]]+\]\} 1-0 $/);
  // Wrapping keeps a move number, its move and its clock together.
  assert.doesNotMatch(pgn, /\.\n/);
  for (const l of pgn.split("\n")) assert.ok(l.length <= 80 || l.startsWith("["), l);
});

test("%clk formatting", () => {
  assert.equal(formatClk(298_300), "0:04:58.3");
  assert.equal(formatClk(298_399), "0:04:58.3");
  assert.equal(formatClk(3_725_400), "1:02:05.4");
  assert.equal(formatClk(0), "0:00:00.0");
});

test("SetUp/FEN only for non-initial starts; Black-to-move numbering starts with 10...", () => {
  const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 10";
  const moves = sanToUci(fen, ["Nf6", "Nc3", "Bc5"]);
  const pgn = buildPgn({ ...base, startFen: fen, moves, clocksMs: [], result: { winner: "b", method: "resignation" } });
  assert.match(pgn, /\[SetUp "1"\]\n\[FEN "r1bqkbnr/);
  assert.match(pgn, /\n10\.\.\. Nf6 11\. Nc3 Bc5 0-1\n$/);
  const c = new Chess();
  c.loadPgn(pgn);
  assert.deepEqual(c.history(), ["Nf6", "Nc3", "Bc5"]);
  const withClk = buildPgn({ ...base, startFen: fen, moves, clocksMs: [290_000, 280_000, 270_000], result: null });
  assert.match(
    withClk.replace(/\s+/g, " "),
    /10\.\.\. Nf6 \{\[%clk 0:04:50\.0\]\} 11\. Nc3 \{\[%clk 0:04:40\.0\]\} 11\.\.\. Bc5 \{\[%clk 0:04:30\.0\]\} \*/,
  );
});

test("termination headers per method; ECO/Opening/Elo only when given", () => {
  assert.equal(terminationOf("timeout"), "Time forfeit");
  assert.equal(terminationOf("timeout_vs_insufficient"), "Time forfeit");
  assert.equal(terminationOf("abandoned"), "Abandoned");
  assert.equal(terminationOf("agreement"), "Normal");
  const pgn = buildPgn({
    ...base,
    startFen: INITIAL_FEN,
    moves: uci.slice(0, 4),
    result: { winner: null, method: "agreement" },
    eco: "C41",
    opening: "Philidor Defense",
    whiteElo: 1184,
  });
  assert.match(pgn, /\[Result "1\/2-1\/2"\]/);
  assert.match(pgn, /\[ECO "C41"\]\n\[Opening "Philidor Defense"\]\n\[WhiteElo "1184"\]/);
  assert.doesNotMatch(pgn, /BlackElo/);
  const untimed = buildPgn({
    ...base,
    mode: "BOT",
    tc: null,
    startFen: INITIAL_FEN,
    moves: uci.slice(0, 2),
    result: null,
  });
  assert.match(untimed, /\[TimeControl "-"\]/);
  assert.match(untimed, /\[Event "Replay Chess · Bot game"\]/);
});
