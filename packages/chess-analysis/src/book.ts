// The book set (phase-03 plan §8.4 rule 2, §9.4): every position reached along the `openings` table's lines, keyed
// by EPD (the first four FEN fields, R-ENG-07), so a transposition into theory is still theory.
//
// The worker builds it once at boot from `SELECT pgn FROM openings WHERE "isActive"` (~3.6k rows) and keeps it in
// memory; the web never loads it (§9.4). The seed lines are the Lichess chess-openings dataset (CC0) shipped in
// `apps/web/public/openings/*.tsv`: 3,641 lines, 34,904 positions along them, 7,484 distinct EPDs (measured
// 2026-11-11). The positions are replayed with chess.js only (plan R12): a line that does not replay contributes the
// positions up to its first bad move and is reported, never guessed.
//
// The start position itself is not in the set: rule 2 asks about the position after a ply.

import { Chess } from "chess.js";
import { epdOf } from "./board";

export interface BookSet {
  has(epd: string): boolean;
  readonly size: number;
}

export interface OpeningLine {
  eco: string;
  name: string;
  pgn: string;
}

/** The SAN tokens of an opening's movetext ("1. e4 e5 2. Nf3" → ["e4", "e5", "Nf3"]). */
export function movetextSans(pgn: string): string[] {
  return pgn
    .replace(/\{[^}]*\}/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^\d+\.(\.\.)?/, ""))
    .filter((t) => t !== "" && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t) && !/^\$\d+$/.test(t));
}

export interface LineReplay {
  /** EPD after each replayed ply. */
  epds: string[];
  /** The SAN that failed to replay, or null when the whole line replayed. */
  failedAt: string | null;
}

/** Replays one opening line from the initial position. */
export function replayOpening(pgn: string): LineReplay {
  const chess = new Chess();
  const epds: string[] = [];
  for (const san of movetextSans(pgn)) {
    try {
      chess.move(san);
    } catch {
      return { epds, failedAt: san };
    }
    epds.push(epdOf(chess.fen()));
  }
  return { epds, failedAt: null };
}

export interface BookBuild {
  book: BookSet;
  /** Lines read. */
  lines: number;
  /** Positions replayed along all lines (with repeats). */
  positions: number;
  /** Lines that stopped at an illegal move (index and the move). */
  failures: { index: number; san: string }[];
}

/** Builds the book set from opening PGNs (movetext from the initial position). */
export function buildBookSet(pgns: Iterable<string>): BookBuild {
  const set = new Set<string>();
  const failures: { index: number; san: string }[] = [];
  let lines = 0;
  let positions = 0;
  for (const pgn of pgns) {
    const r = replayOpening(pgn);
    for (const e of r.epds) set.add(e);
    positions += r.epds.length;
    if (r.failedAt !== null) failures.push({ index: lines, san: r.failedAt });
    lines++;
  }
  return { book: { has: (epd) => set.has(epd), size: set.size }, lines, positions, failures };
}

/** Parses the opening TSV format (`eco<TAB>name<TAB>pgn`, one header line). */
export function parseOpeningsTsv(content: string): OpeningLine[] {
  const out: OpeningLine[] = [];
  const rows = content.split(/\r?\n/);
  for (const row of rows.slice(1)) {
    if (row.trim() === "") continue;
    const [eco, name, pgn] = row.split("\t");
    if (!eco || !name || !pgn) continue;
    out.push({ eco: eco.trim(), name: name.trim(), pgn: pgn.trim() });
  }
  return out;
}

/**
 * The deepest opening a game reached (§8.12 step 8): the last position of `epds` (the game's positions in order)
 * that is the final position of an opening line. `byEpd` maps an opening's final EPD to its ECO and name (the
 * worker reads it with `SELECT eco, name FROM openings WHERE epd = ANY($1)`).
 */
export function deepestOpening<T>(epds: readonly string[], byEpd: ReadonlyMap<string, T>): T | null {
  for (let i = epds.length - 1; i >= 0; i--) {
    const hit = byEpd.get(epds[i] as string);
    if (hit !== undefined) return hit;
  }
  return null;
}
