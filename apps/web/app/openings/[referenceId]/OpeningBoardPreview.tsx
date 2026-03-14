"use client";

import { Chess, type Square } from "chess.js";
import ChessBoard from "../../components/ChessBoard";

export function OpeningBoardPreview({ fen, pgn }: { fen: string; pgn?: string }) {
  let board;
  let turn: "w" | "b";
  let lastMove: { from: Square; to: Square } | null = null;

  try {
    if (pgn) {
      const chess = new Chess();
      chess.loadPgn(pgn);
      board = chess.board();
      turn = chess.turn() === "w" ? "b" : "w";
      const last = chess.history({ verbose: true }).at(-1);
      if (last) {
        lastMove = { from: last.from, to: last.to };
      }
    } else {
      const chess = new Chess(fen);
      board = chess.board();
      turn = chess.turn() === "w" ? "b" : "w";
    }
  } catch {
    return null;
  }

  return (
    <div>
      <div className="m-4">
        <ChessBoard
          board={board}
          squareSize="md"
          isInteractive={false}
          playerColor={turn}
          showCoordinates={true}
          lastMove={lastMove}
        />
      </div>
      <p
        style={{ fontFamily: "'Geist', sans-serif" }}
        className="text-[10px] text-cb-text-faint uppercase tracking-[0.2em] text-center mt-6"
      >
        Resulting Position
      </p>
    </div>
  );
}
