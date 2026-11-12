// pgn.ts: the client download builds the same PGN and file name as A8.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import { reviewFixture } from "@repo/contracts/http/fixtures/review";
import { annotatedPgnFilename } from "@repo/contracts/http/review";
import { annotatedPgnOf, pgnFilename } from "./pgn";

test("the file name matches the contract helper", () => {
  const at = new Date("2026-11-09T18:42:10.000Z");
  for (const [w, b] of [
    ["knightowl_88", "tal_fan_77"],
    ["Ángel Ñúñez", "Engine 1200"],
    ["", "!!!"],
  ] as const) {
    assert.equal(pgnFilename(w, b, at), annotatedPgnFilename(w, b, at));
  }
});

test("the annotated PGN of the done fixture re-parses and carries the grades and the moment text", () => {
  const { text, filename } = annotatedPgnOf(reviewFixture("done"), "https://playchess.tech");
  assert.equal(filename, "replaychess-knightowl_88-vs-tal_fan_77-2026-11-09.pgn");
  assert.match(text, /\[Site "https:\/\/playchess\.tech"\]/);
  assert.match(text, /\[ECO "C59"\]/);
  assert.match(text, /Qd2 \$2/, "19.Qd2 is a Miss ($2)");
  assert.match(text, /Rxf5 wins the bishop on f5\./, "moment why text as a comment");
  const chess = new Chess();
  chess.loadPgn(text);
  assert.equal(chess.history().length, 54);
});

test("a game still being analysed exports its moves without grades for the ungraded plies", () => {
  const { text } = annotatedPgnOf(reviewFixture("running"), "https://playchess.tech");
  const chess = new Chess();
  chess.loadPgn(text);
  assert.equal(chess.history().length, 54);
  assert.ok(!/Qd2 \$/.test(text), "ply 36 is not graded yet");
});
