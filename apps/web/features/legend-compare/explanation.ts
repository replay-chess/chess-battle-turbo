// The static narration's board (phase-03 plan §3.2 "Moved and restyled": the legacy NarrationDisplay/AudioControls
// /ExplanationView drove the legacy hook `useExplanationPlayer`; this is its pure core). Given the authored explanation
// (`chess_positions.explanation`: segments of narration with board cues, each cue optionally timed) and a time in the
// audio, it returns the board the narration has reached: every cue of the earlier segments, then the cues of the
// current segment whose `triggerTime` has passed (untimed cues apply at the segment's start). Moves are applied in
// array order, as the legacy player did, so a later move never lands before an earlier one. Without audio (manual
// mode) a whole segment applies at once.
import { Chess, type Square } from "chess.js";
import type { ExplanationSegment, ExplanationVisual, StaticExplanation } from "@repo/contracts/http/legend";

export type MoveQualityKey =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "book"
  | "forced"
  | "interesting"
  | "inaccuracy"
  | "mistake"
  | "miss"
  | "blunder";

export interface ExplanationBoard {
  fen: string;
  last: [Square, Square] | null;
  highlights: Partial<Record<Square, string>>;
  arrows: { from: Square; to: Square; color: string }[];
  badges: { sq: Square; kind: MoveQualityKey }[];
  /** The authored eval bar cue: centipawns (White POV) and its words. */
  evalBar: { score: number; description: string } | null;
}

/** The authored annotation symbols as the board's move-quality badges (the legacy `annotateSquare` symbols). */
const SYMBOL_BADGE: Record<string, MoveQualityKey> = {
  "!!": "brilliant",
  "!": "great",
  best: "best",
  excellent: "excellent",
  good: "good",
  book: "book",
  forced: "forced",
  "!?": "interesting",
  "?!": "inaccuracy",
  "?": "mistake",
  "??": "blunder",
  miss: "miss",
};

const SQUARE_RE = /^[a-h][1-8]$/;
const isSquare = (s: string | undefined): s is Square => !!s && SQUARE_RE.test(s);

interface State {
  chess: Chess;
  start: string;
  last: [Square, Square] | null;
  highlights: Partial<Record<Square, string>>;
  arrows: { from: Square; to: Square; color: string }[];
  badges: { sq: Square; kind: MoveQualityKey }[];
  evalBar: ExplanationBoard["evalBar"];
}

function apply(s: State, v: ExplanationVisual): void {
  switch (v.type) {
    case "clearVisuals":
      s.highlights = {};
      s.arrows = [];
      s.badges = [];
      s.last = null;
      return;
    case "resetBoard":
      s.chess = new Chess(s.start);
      s.last = null;
      s.badges = [];
      s.evalBar = null;
      return;
    case "highlight":
      for (const sq of v.squares ?? []) if (isSquare(sq)) s.highlights[sq] = v.color || "yellow";
      return;
    case "arrow":
      if (isSquare(v.from) && isSquare(v.to)) s.arrows.push({ from: v.from, to: v.to, color: v.color || "yellow" });
      return;
    case "showMove": {
      const san = v.san;
      if (!san) return;
      let mv = null;
      try {
        mv = s.chess.move(san);
      } catch {
        try {
          mv = s.chess.move({ from: san.slice(0, 2), to: san.slice(2, 4), promotion: san.length > 4 ? san[4] : undefined });
        } catch {
          mv = null;
        }
      }
      if (mv) s.last = [mv.from, mv.to];
      return;
    }
    case "undoMoves": {
      const n = Math.max(1, v.count ?? 1);
      for (let i = 0; i < n; i++) s.chess.undo();
      s.last = null;
      s.badges = [];
      return;
    }
    case "annotate":
    case "annotateSquare": {
      const kind = v.symbol ? SYMBOL_BADGE[v.symbol] : undefined;
      if (isSquare(v.square) && kind) s.badges = [...s.badges.filter((b) => b.sq !== v.square), { sq: v.square, kind }];
      return;
    }
    case "showEvalBar":
      if (typeof v.score === "number") s.evalBar = { score: v.score, description: v.description ?? "" };
      return;
  }
}

/** The segment playing at time `t` (seconds): the last one that started at or before `t`. */
export function segmentAt(segments: readonly Pick<ExplanationSegment, "startTime">[], t: number): number {
  let idx = 0;
  for (let i = 0; i < segments.length; i++) if (segments[i]!.startTime <= t) idx = i;
  return idx;
}

/** The narration's total length: the last segment's end (the audio's own duration replaces it once known). */
export function narrationLength(e: Pick<StaticExplanation, "segments">): number {
  return e.segments.reduce((m, s) => Math.max(m, s.endTime), 0);
}

/**
 * The board after the narration reached `t` seconds (audio mode), or after segment `segment` in full (manual mode,
 * `t` null).
 */
export function explanationBoardAt(e: StaticExplanation, at: { t: number } | { segment: number }): ExplanationBoard {
  let chess: Chess;
  try {
    chess = new Chess(e.fen);
  } catch {
    chess = new Chess();
  }
  const s: State = { chess, start: chess.fen(), last: null, highlights: {}, arrows: [], badges: [], evalBar: null };
  const current = "t" in at ? segmentAt(e.segments, at.t) : Math.min(Math.max(0, at.segment), Math.max(0, e.segments.length - 1));
  for (let i = 0; i < current; i++) for (const v of e.segments[i]?.visuals ?? []) apply(s, v);
  const seg = e.segments[current];
  if (seg) {
    const reached = (v: ExplanationVisual) => !("t" in at) || v.triggerTime === undefined || v.triggerTime <= at.t;
    // Board cues first (they may refer to squares a move then changes), then the moves in array order up to the latest
    // one reached, as the legacy player did.
    for (const v of seg.visuals) if (v.type !== "showMove" && reached(v)) apply(s, v);
    let lastMove = -1;
    seg.visuals.forEach((v, i) => {
      if (v.type === "showMove" && reached(v)) lastMove = i;
    });
    for (let i = 0; i <= lastMove; i++) {
      const v = seg.visuals[i]!;
      if (v.type === "showMove") apply(s, v);
    }
  }
  return { fen: s.chess.fen(), last: s.last, highlights: s.highlights, arrows: s.arrows, badges: s.badges, evalBar: s.evalBar };
}

/** The word being spoken at `t` (the authored alignment), or -1. */
export function wordAt(alignment: StaticExplanation["alignment"], t: number): number {
  if (!alignment) return -1;
  const { startTimes, endTimes } = alignment;
  for (let i = 0; i < startTimes.length; i++) {
    if (t >= startTimes[i]! && t < (endTimes[i] ?? startTimes[i]!)) return i;
  }
  return -1;
}
