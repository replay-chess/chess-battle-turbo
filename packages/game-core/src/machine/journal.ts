// Journal lines (plan 7.6). The reducer emits them as `journal` effects; the socket appends them as ndjson to
// /data/journal/{ref}.ndjson (WS/src/persist/journal.ts) and folds them back with `foldJournal` at restore.
// A reader that meets an `open.v` newer than JOURNAL_VERSION must skip the file and restore from the DB row only.

import type { EndMethod, Phase, Side } from "./types";

export const JOURNAL_VERSION = 1;

export type JournalLine =
  | {
      t: "open";
      v: number;
      at: number;
      ref: string;
      startFen: string;
      tc: { i: number; inc: number } | null;
      colors: { w: string | null; b: string | null };
      studyS: number;
    }
  | { t: "phase"; at: number; phase: Phase; endsAt?: number; side?: Side }
  | { t: "ready"; at: number; side: Side }
  /** `n`: 1-based index into this game's moves (relative to the start FEN; wire plies are absolute). */
  | { t: "ply"; n: number; uci: string; san: string; clk: number | null; spent: number; at: number; pm?: 1 }
  | { t: "draw"; at: number; by: Side; ply: number }
  | { t: "drawx"; at: number; by: Side; canAt: number; implicit?: 1 }
  | { t: "pres"; at: number; side: Side; online: boolean; grace?: number }
  /** `w`/`b`: both clocks at `at` (the running side's value settled), so a restore after a drain is exact. */
  | { t: "freeze"; at: number; w?: number; b?: number }
  | { t: "resume"; at: number }
  /** `ply`: absolute, as on the wire (`result.ply`). */
  | { t: "end"; at: number; method: EndMethod; winner: Side | null; ply: number; by?: string }
  | {
      t: "rematch";
      at: number;
      by: Side;
      what: "offered" | "declined" | "cancelled" | "expired" | "started";
      newRef?: string;
    }
  /** Written by the socket after a checkpoint commits: DB acknowledged up to ply n. */
  | { t: "flushed"; n: number };

export interface FoldedJournal {
  open: Extract<JournalLine, { t: "open" }> | null;
  moves: string[];
  sans: string[];
  clocksMs: number[];
  spentMs: number[];
  phase: Phase;
  /** Study end or first-move deadline of the last phase line. */
  phaseEndsAt: number | null;
  firstMoveSide: Side | null;
  ready: { w: boolean; b: boolean };
  drawOffer: { by: Side; ply: number } | null;
  canOfferAtPly: { w: number; b: number };
  end: Extract<JournalLine, { t: "end" }> | null;
  /** Time of the last line (or of the freeze line when the server drained). */
  lastAt: number;
  frozenAt: number | null;
  frozenClocks: { w: number; b: number } | null;
  flushed: number;
  /** When the playing phase started (for game duration). */
  playingAt: number | null;
  /** When the clock of the side to move last started: the playing phase, its last ply, or the last resume. */
  turnStartAt: number | null;
  /** Both clocks at the last resume (the freeze line's values), until the next ply. */
  turnBaseClocks: { w: number; b: number } | null;
}

export function canReadJournal(open: { v: number } | null | undefined): boolean {
  return !!open && open.v <= JOURNAL_VERSION;
}

/** Folds journal lines (in file order) into the progress a restore needs. Unknown line types are ignored. */
export function foldJournal(lines: readonly JournalLine[]): FoldedJournal {
  const f: FoldedJournal = {
    open: null,
    moves: [],
    sans: [],
    clocksMs: [],
    spentMs: [],
    phase: "waiting",
    phaseEndsAt: null,
    firstMoveSide: null,
    ready: { w: false, b: false },
    drawOffer: null,
    canOfferAtPly: { w: 0, b: 0 },
    end: null,
    lastAt: 0,
    frozenAt: null,
    frozenClocks: null,
    flushed: 0,
    playingAt: null,
    turnStartAt: null,
    turnBaseClocks: null,
  };
  for (const line of lines) {
    if ("at" in line && typeof line.at === "number") f.lastAt = Math.max(f.lastAt, line.at);
    switch (line.t) {
      case "open":
        f.open = line;
        break;
      case "phase":
        f.phase = line.phase;
        f.phaseEndsAt = line.endsAt ?? null;
        f.firstMoveSide = line.phase === "first_move" ? (line.side ?? null) : null;
        if (line.phase === "playing") {
          f.playingAt = line.at;
          f.turnStartAt = line.at;
        }
        if (line.phase !== "study") f.ready = { w: false, b: false };
        break;
      case "ready":
        f.ready[line.side] = true;
        break;
      case "ply":
        if (line.n !== f.moves.length + 1) break; // a duplicate or out-of-order line: the first copy wins
        f.moves.push(line.uci);
        f.sans.push(line.san);
        if (line.clk !== null) f.clocksMs.push(line.clk);
        f.spentMs.push(line.spent);
        f.turnStartAt = line.at;
        f.turnBaseClocks = null;
        break;
      case "draw":
        f.drawOffer = { by: line.by, ply: line.ply };
        break;
      case "drawx": // `by` declined; the cooldown applies to the offerer
        f.drawOffer = null;
        f.canOfferAtPly[line.by === "w" ? "b" : "w"] = line.canAt;
        break;
      case "freeze":
        f.frozenAt = line.at;
        f.frozenClocks = line.w !== undefined && line.b !== undefined ? { w: line.w, b: line.b } : null;
        break;
      case "resume":
        f.turnStartAt = line.at;
        f.turnBaseClocks = f.frozenClocks;
        f.frozenAt = null;
        f.frozenClocks = null;
        break;
      case "end":
        f.end = line;
        f.phase = "ended";
        f.drawOffer = null;
        break;
      case "flushed":
        f.flushed = Math.max(f.flushed, line.n);
        break;
      default:
        break;
    }
  }
  return f;
}
