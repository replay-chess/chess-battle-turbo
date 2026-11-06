"use client";

/**
 * Pieces (P2 plan §4.5.1 PieceLayer). Each piece is a plain <img> (not
 * next/image) inside its [data-square] cell, keyed by a stable id from
 * diffPieces(), so only the moved pieces remount. A moved piece slides from its
 * old cell (FLIP, 180 ms ease-out), a captured one fades (120 ms), and a promoted
 * pawn slides as a pawn and becomes the new piece at the end of the slide.
 */
import { useState, type CSSProperties } from "react";
import { diffPieces, displayPos, placedPieces, placementKey, pieceColor, pieceName, type DiffedPiece, type PlacedPiece } from "./geometry";
import type { PieceCode, Side, Sq } from "./types";

export const pieceSrc = (p: PieceCode) => `/chess-icons/${p}.png`;

interface Tracks {
  key: string;
  orientation: Side;
  gen: number;
  pieces: DiffedPiece[];
  removed: PlacedPiece[];
}

export interface PieceView {
  bySq: Map<Sq, DiffedPiece>;
  removedBySq: Map<Sq, PlacedPiece>;
}

/**
 * Keeps piece ids across positions. The diff runs during render when the
 * placement changes (the "store the previous prop in state" pattern), so the
 * first paint of a new position already has its slides.
 * `instant`: a move dropped by drag, which lands without a slide.
 */
export function usePieceTracks(
  fen: string,
  orientation: Side,
  lastMove: readonly [Sq, Sq] | null | undefined,
  instant: { from: Sq; to: Sq } | null,
): PieceView {
  const key = placementKey(fen);
  const [tracks, setTracks] = useState<Tracks>(() => ({ key, orientation, gen: 0, pieces: placedPieces(fen), removed: [] }));
  let current = tracks;
  if (tracks.key === key && tracks.orientation !== orientation) {
    // A flip remounts every cell: settle the last slide and fade instead of replaying them.
    current = { ...tracks, orientation, pieces: tracks.pieces.map((p) => ({ id: p.id, piece: p.piece, sq: p.sq })), removed: [] };
    setTracks(current);
  } else if (tracks.key !== key) {
    const gen = tracks.gen + 1;
    const move = lastMove ? { from: lastMove[0], to: lastMove[1] } : null;
    const d = diffPieces(tracks.pieces, fen, move, gen);
    const pieces = d.pieces.map((p) =>
      instant && p.from === instant.from && p.sq === instant.to && !p.fromPiece ? { id: p.id, piece: p.piece, sq: p.sq } : p,
    );
    current = { key, orientation, gen, pieces, removed: d.removed };
    setTracks(current);
  }
  const bySq = new Map<Sq, DiffedPiece>();
  for (const p of current.pieces) bySq.set(p.sq, p);
  const removedBySq = new Map<Sq, PlacedPiece>();
  for (const p of current.removed) removedBySq.set(p.sq, p);
  return { bySq, removedBySq };
}

type SlideStyle = CSSProperties & { "--rc-dx"?: number; "--rc-dy"?: number };

function slideStyle(p: DiffedPiece, orientation: Side): SlideStyle | undefined {
  if (!p.from) return undefined;
  const a = displayPos(p.from, orientation);
  const b = displayPos(p.sq, orientation);
  return { "--rc-dx": a.col - b.col, "--rc-dy": a.row - b.row };
}

/** The piece in a cell, plus the pawn it was during a promotion slide. */
export function PieceSprite({
  piece,
  orientation,
  animate,
  shake,
  lifted,
}: {
  piece: DiffedPiece;
  orientation: Side;
  animate: boolean;
  shake?: "a" | "b";
  lifted: boolean;
}) {
  const slide = animate ? slideStyle(piece, orientation) : undefined;
  const promo = !!(slide && piece.fromPiece);
  return (
    <>
      {promo ? (
        <span
          aria-hidden="true"
          className="rc-bd-from"
          data-color={pieceColor(piece.fromPiece!)}
          style={{ ...slide, backgroundImage: `url(${pieceSrc(piece.fromPiece!)})` }}
        />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- plan §4.5.1: plain <img decoding="async">; next/image would rewrite src and add wrappers inside the cell */}
      <img
        key={piece.id}
        src={pieceSrc(piece.piece)}
        alt={pieceName(piece.piece)}
        aria-hidden="true"
        draggable={false}
        decoding="async"
        className="rc-bd-piece"
        data-piece={piece.piece}
        data-color={pieceColor(piece.piece)}
        data-slide={slide ? "" : undefined}
        data-promo={promo ? "" : undefined}
        data-shake={shake}
        data-lifted={lifted ? "" : undefined}
        style={slide}
      />
    </>
  );
}

/** A captured piece fading out in the cell it left (no <img>, so the cell keeps one image). */
export function FadingPiece({ piece }: { piece: PlacedPiece }) {
  return (
    <span
      key={`${piece.id}-fade`}
      aria-hidden="true"
      className="rc-bd-fade"
      data-color={pieceColor(piece.piece)}
      style={{ backgroundImage: `url(${pieceSrc(piece.piece)})` }}
    />
  );
}
