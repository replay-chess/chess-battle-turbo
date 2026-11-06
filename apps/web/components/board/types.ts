/**
 * V3MoveBoard types (P2 plan §4.5.2). The board is a pure view plus an input
 * state machine: it never owns chess rules. Legal targets come from `dests`
 * (game-core in the game screen, chess.js on the dev page).
 */

import type { Side } from "@repo/contracts/socket/game";

/** The wire colour type (one source: `@repo/contracts/socket/game`). */
export type { Side };
export type FileChar = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";
export type RankChar = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type Sq = `${FileChar}${RankChar}`;

export type PromotionPiece = "q" | "r" | "b" | "n";
export type PieceType = "k" | "q" | "r" | "b" | "n" | "p";
/** Colour + type, the name of the image in /chess-icons: "wk", "bp", ... */
export type PieceCode = `${Side}${PieceType}`;

export interface BoardMove {
  from: Sq;
  to: Sq;
  promotion?: PromotionPiece;
  uci: string;
}

/** The 12 move-quality labels (DS MoveQualityBadge). */
export type MoveQuality =
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

/** Move quality or an end-of-game mark (§4.3 "Board badges at game end"). */
export type BadgeKind = MoveQuality | "mate" | "win" | "flag" | "draw";

export interface BoardBadge {
  sq: Sq;
  kind: BadgeKind;
  label: string;
}

export interface BoardArrow {
  from: Sq;
  to: Sq;
  /**
   * A DS token name ("arrow-default", "pv-1".."pv-5"), one of the drawing
   * colours ("green", "red", "blue") or any CSS colour. Default: arrow-default.
   */
  color?: string;
}

export interface BoardGhost {
  sq: Sq;
  piece: PieceCode;
}

export interface BoardProps {
  /** Position to show (live or viewed ply). */
  fen: string;
  /** "orient" in V3MoveBoard: the colour at the bottom. */
  orientation: Side;
  /** Which colour may move now; null = no input. */
  mover: Side | null;
  /** Colour that may queue a premove (opponent's turn). */
  premover?: Side | null;
  /** Legal targets for the mover. */
  dests: (from: Sq) => Sq[];
  /** Pseudo-legal targets after a null move (premoves). */
  premoveDests?: (from: Sq) => Sq[];
  /** A validated move (promotion already chosen). */
  onMove: (m: BoardMove) => void;
  /** Premove set, or null = cancelled (Esc, right-click, click on its from-square). */
  onPremove?: (m: BoardMove | null) => void;
  /** A drop or click on a square that is not a target; the parent asks game-core for the reason. */
  onIllegal?: (from: Sq, to: Sq) => void;
  /** A piece was pressed while input is locked (study phase). */
  onLockedAttempt?: () => void;
  /** Selection changed (the parent shows game-core describeSelection() in the status line). */
  onSelect?: (sq: Sq | null) => void;
  /** The promotion picker was closed without a piece (Esc, ESC button, backdrop). */
  onPromotionCancel?: () => void;
  /** The promotion picker opened for a move (status line "Choose a piece · Esc puts the pawn back"). */
  onPromotionOpen?: (from: Sq, to: Sq) => void;
  lastMove?: readonly [Sq, Sq] | null;
  /** King square in check. */
  check?: Sq | null;
  /** The queued premove, drawn as a tinted from/to pair (the ghost is passed separately). */
  premove?: { from: Sq; to: Sq } | null;
  /** "hl": token name ("highlight-green"), CSS colour or a full gradient. */
  highlights?: Partial<Record<Sq, string>>;
  /** "ring": inset ring colour. */
  rings?: Partial<Record<Sq, string>>;
  arrows?: readonly BoardArrow[];
  /** Right-drag arrows and right-click highlights (local, never sent). */
  allowDrawArrows?: boolean;
  badges?: readonly BoardBadge[];
  /** Premove or queued move. */
  ghost?: BoardGhost | null;
  /** Waiting, viewing (0.9 opacity). */
  dimmed?: boolean;
  /** Static: no input, no coordinates. */
  thumb?: boolean;
  /** Default true. */
  coordinates?: boolean;
  /** Default 180; 0 when snapping to a resync. Reduced motion is handled in CSS. */
  animationMs?: number;
  /** aria-label of the grid ("Board. You are White."). */
  label: string;
  /** Default "chess-board". */
  testId?: string;
  className?: string;
}
