// What the public share page and its image show (phase-03 plan §4.4, §5.5, §11.3), built from the frozen snapshot
// alone (ShareSnapshotV1: the masked names, the moves, the judgements, the accuracy, the card moment and the summary).
// Pure and server-side: the moves are replayed here with chess.js once, so the page's stepper island receives the
// positions as FEN placements and ships no chess code (plan §9.6: `/r/[code]` ≤ 120 kB, the island ≤ 6 kB).
//
// The snapshot already carries the §11.3 masking (A10/A11 decide it), so this file never decides a name: it only
// orders them (the sharer first) and labels them. No refs, ids or clocks exist in the snapshot to leak.
import { Chess } from "chess.js";
import { judgementFromChar, judgementKey, moveLabel, type JudgementKey } from "@repo/chess-analysis/codec";
import type { ShareSnapshotV1 } from "@repo/db/json";

export type Side = "w" | "b";

/** One position of the stepper: index 0 is the start, index i + 1 the position after ply i. */
export interface ShareFrame {
  /** The FEN placement field (pieces only). */
  placement: string;
  /** The from/to squares of the move that reached this position. */
  last: [string, string] | null;
  /** "19." / "19…" + SAN of that move; null for the start. */
  label: string | null;
  /** The move's grade; null for the start and for an ungraded ply. */
  q: JudgementKey | null;
  /** The king in check in this position. */
  check: string | null;
}

export interface SharePlayer {
  name: string;
  rating: number | null;
  /** The sharer's side (the snapshot's `isYou`; the page never knows who is looking). */
  sharer: boolean;
}

export interface ShareView {
  /** "knightowl_88 vs tal_fan_77", sharer first. */
  title: string;
  /** "Rapid 10+0 · 0–1 resigned". */
  meta: string;
  playedOn: string;
  /** The sharer's colour: the board's bottom side. */
  orientation: Side;
  players: Record<Side, SharePlayer>;
  /** Accuracy of the sharer and of the opponent (whole numbers), null when ungraded. */
  accuracy: { you: number | null; opp: number | null };
  summary: string[];
  frames: ShareFrame[];
  /** The frame the page opens on: the key moment's, else the final position. */
  startIndex: number;
  /** The card's key moment on its frame (the position after the played move, the engine's move as the arrow). */
  moment: { index: number; arrow: [string, string]; caption: string; q: JudgementKey | null } | null;
  /** Graded plies (the strip's length). */
  plies: number;
}

const RESULT_LABEL: Record<string, string> = { "1-0": "1–0", "0-1": "0–1", "½-½": "½–½", "1/2-1/2": "½–½" };

/** "1–0" with an en dash (the review's `resultLabel`). */
export function resultLabel(result: string): string {
  return RESULT_LABEL[result] ?? result;
}

/** "Rating 1184" style suffix: "knightowl_88 (1184)". */
export function playerLabel(p: Pick<SharePlayer, "name" | "rating">): string {
  return p.rating !== null ? `${p.name} (${p.rating})` : p.name;
}

/** The ply offset of a FEN's side to move from the game's first move (§8.1 startPly). */
export function startPlyOf(fen: string): number {
  const parts = fen.split(" ");
  const full = Number(parts[5] ?? "1");
  const fullmove = Number.isFinite(full) && full >= 1 ? Math.floor(full) : 1;
  return (fullmove - 1) * 2 + (parts[1] === "b" ? 1 : 0);
}

function judgementAt(j: string, ply: number): JudgementKey | null {
  const ch = j.charAt(ply);
  if (!ch) return null;
  try {
    return judgementKey(judgementFromChar(ch));
  } catch {
    return null;
  }
}

function kingInCheck(chess: Chess): string | null {
  if (!chess.inCheck()) return null;
  return chess.findPiece({ type: "k", color: chess.turn() })[0] ?? null;
}

/**
 * The frames of the snapshot's game. A move that does not replay (a corrupt snapshot) ends the list there; the frames
 * before it still show.
 */
export function shareFrames(s: Pick<ShareSnapshotV1, "startFen" | "moves" | "j">): ShareFrame[] {
  let chess: Chess;
  try {
    chess = new Chess(s.startFen);
  } catch {
    return [];
  }
  const startPly = startPlyOf(s.startFen);
  const frames: ShareFrame[] = [{ placement: chess.fen().split(" ")[0]!, last: null, label: null, q: null, check: kingInCheck(chess) }];
  const moves = s.moves.trim() === "" ? [] : s.moves.trim().split(/\s+/);
  for (let i = 0; i < moves.length; i++) {
    const uci = moves[i]!;
    let san: string;
    try {
      san = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined }).san;
    } catch {
      break;
    }
    frames.push({
      placement: chess.fen().split(" ")[0]!,
      last: [uci.slice(0, 2), uci.slice(2, 4)],
      label: `${moveLabel(i, startPly)}${san}`,
      q: judgementAt(s.j, i),
      check: kingInCheck(chess),
    });
  }
  return frames;
}

/** The share page's view of a snapshot. */
export function shareViewOf(s: ShareSnapshotV1): ShareView {
  const sharerSide: Side = s.players.b.isYou && !s.players.w.isYou ? "b" : "w";
  const opp: Side = sharerSide === "w" ? "b" : "w";
  const players: Record<Side, SharePlayer> = {
    w: { name: s.players.w.name, rating: s.players.w.rating, sharer: sharerSide === "w" },
    b: { name: s.players.b.name, rating: s.players.b.rating, sharer: sharerSide === "b" },
  };
  const frames = shareFrames(s);
  const moment =
    s.moment && s.moment.ply + 1 < frames.length
      ? {
          index: s.moment.ply + 1,
          arrow: s.moment.arrow,
          caption: s.moment.caption,
          q: judgementKey(s.moment.judgement),
        }
      : null;
  // The end label already carries the result ("0–1 resigned", the review's header); the bare result only without one.
  const end = s.endLabel.trim() !== "" ? s.endLabel : resultLabel(s.result);
  const meta = [s.tcLabel, end].filter((x) => x.trim() !== "").join(" · ");
  return {
    title: `${players[sharerSide].name} vs ${players[opp].name}`,
    meta,
    playedOn: s.playedOn,
    orientation: sharerSide,
    players,
    accuracy: {
      you: s.accuracy.you === null ? null : Math.round(s.accuracy.you),
      opp: s.accuracy.opp === null ? null : Math.round(s.accuracy.opp),
    },
    summary: s.summary,
    frames,
    startIndex: moment ? moment.index : Math.max(0, frames.length - 1),
    moment,
    plies: Math.max(0, frames.length - 1),
  };
}

/** "Accuracy 85 · opponent 89" (or the one that exists). */
export function accuracyLine(a: ShareView["accuracy"]): string | null {
  if (a.you === null && a.opp === null) return null;
  if (a.opp === null) return `Accuracy ${a.you}`;
  if (a.you === null) return `Opponent accuracy ${a.opp}`;
  return `Accuracy ${a.you} · opponent ${a.opp}`;
}

/** The page title and description (metadata, unfurls). Names follow the snapshot's masking. */
export function shareMetaText(view: ShareView): { title: string; description: string } {
  const acc = accuracyLine(view.accuracy);
  return {
    title: `${view.title} · Game Review`,
    description: [view.meta, acc].filter(Boolean).join(" · ") || "A game graded move by move on Replay Chess.",
  };
}
