// Loader for the edge label fixtures in `fixtures/labels/edge/*.json` (phase-03 plan §12.4): small games at the
// rule boundaries of §8.4 (thresholds, mate rules, MISS from a missed mate, FORCED, the book chain and its cap, a FEN
// start, a stalemate and a threefold final ply, promotions).
//
// Every file is `"provenance": "constructed"`: the evals are chosen to sit on a rule boundary, so they test the
// grading arithmetic, not engine facts, and the nightly eval-provenance job (task A7) must skip them. Positions and
// moves are real and replay with chess.js.
//
// File shape: `{ name, provenance, note, games: EdgeGame[] }`. Per game, `best` (SAN per position, optional, null =
// unknown) and `second` (stored evals, optional) feed the grader like the stored arrays; the book set is either
// `bookAll` (every position the game reaches) or `bookPlies` (the positions after those plies).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GradeGameInput } from "../../src/classify";
import type { JudgementKey } from "../../src/codec";
import { encodeMove } from "../../src/codec";
import { replaySan, uciOf } from "../../src/replay";

export interface EdgeGame {
  id: string;
  note?: string;
  startFen: string;
  /** SAN moves. */
  moves: string[];
  /** Stored evals of positions 0 … n (White POV). */
  evals: number[];
  best?: (string | null)[];
  second?: number[];
  bookAll?: boolean;
  bookPlies?: number[];
  /** Expected label per ply. */
  expected: JudgementKey[];
  /** How the game ends, checked against the replay. */
  final?: "stalemate" | "threefold" | "checkmate";
}

export interface EdgeFile {
  name: string;
  provenance: "constructed";
  note: string;
  games: EdgeGame[];
}

export const EDGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "edge");

export function loadEdgeFiles(): EdgeFile[] {
  return readdirSync(EDGE_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(EDGE_DIR, f), "utf8")) as EdgeFile);
}

/** Grader input for an edge game (moves replayed from its FEN; best SANs converted to MoveCodes). */
export function edgeGradeInput(g: EdgeGame): GradeGameInput {
  const replay = replaySan(g.startFen, g.moves);
  const best = g.best?.map((san, i) => (san === null ? 0 : encodeMove(uciOf(replay.fens[i] as string, san))));
  const book = new Set<string>();
  if (g.bookAll) replay.epds.slice(1).forEach((e) => book.add(e));
  for (const ply of g.bookPlies ?? []) book.add(replay.epds[ply + 1] as string);
  const hasBook = g.bookAll === true || g.bookPlies !== undefined;
  return {
    replay,
    evals: g.evals,
    ...(best ? { best } : {}),
    ...(g.second ? { second: g.second } : {}),
    ...(hasBook ? { isBook: (epd: string) => book.has(epd) } : {}),
  };
}
