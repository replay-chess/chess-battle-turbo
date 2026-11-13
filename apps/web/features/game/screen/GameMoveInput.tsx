"use client";

// The typed move input under the game board (plan 4.5.1, 4.5.3 rule 8, 12.6): "Type a move, for example Nf3". SAN
// or UCI, checked against the shown position with the same reasons as the board (explainIllegal), then sent through
// the controller like a board move. Mounted by GameBoardArea (eagerly: it is server-rendered),
// visually hidden until focused, not shown on touch-first devices (board.css). regression: FIX-A — it was mounted
// only on /dev/ui/board.

import { MoveInput, type MoveInputResult } from "@/components/board/MoveInput";
import type { BoardMove, Sq } from "@/components/board/types";
import { explainIllegal } from "@repo/game-core/rules/explainIllegal";
import { Chess, parseUci } from "@repo/game-core/rules/chess";
import type { Side } from "@repo/game-core/machine/types";

export function resolveTypedMove(fen: string, text: string, mover: Side | null): MoveInputResult {
  if (!mover) return { ok: false, reason: "It isn’t your move." };
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return { ok: false, reason: "The position is not valid." };
  }
  if (chess.turn() !== mover) return { ok: false, reason: "It isn’t your move." };
  const uci = parseUci(text.trim().toLowerCase());
  try {
    const r = uci
      ? chess.move({ from: uci.from, to: uci.to, promotion: uci.promotion ?? "q" })
      : chess.move(text.trim().replace(/[+#!?]+$/, ""));
    const move: BoardMove = {
      from: r.from as Sq,
      to: r.to as Sq,
      uci: r.lan,
      ...(r.promotion ? { promotion: r.promotion as BoardMove["promotion"] } : {}),
    };
    return { ok: true, move };
  } catch {
    if (uci) return { ok: false, reason: explainIllegal(fen, uci.from, uci.to, { mover, names: { w: "", b: "" } }).toast };
    return { ok: false, reason: `That move isn’t legal: ${text.trim()}.` };
  }
}

export default function GameMoveInput({
  fen,
  mover,
  onMove,
}: {
  fen: string;
  mover: Side | null;
  onMove: (m: BoardMove) => void;
}) {
  return <MoveInput resolve={(text) => resolveTypedMove(fen, text, mover)} onMove={onMove} disabled={!mover} />;
}
