"use client";

import { useEffect, useRef } from "react";
import { Move, Color } from "chess.js";
import { cn } from "../../../lib/utils";

interface PracticeMoveListProps {
  moveHistory: Move[];
  isBotThinking: boolean;
  gameOver: boolean;
  gameOverReason: string | null;
  gameResult: "win" | "loss" | "draw" | null;
  onReset: () => void;
  onBackToAnalysis: () => void;
  playerColor: Color;
  startingSide: "w" | "b";
  skillLevel?: number;
  depth?: number;
}

export default function PracticeMoveList({
  moveHistory,
  isBotThinking,
  gameOver,
  gameOverReason,
  gameResult,
  onReset,
  onBackToAnalysis,
  playerColor,
  startingSide,
  skillLevel,
  depth,
}: PracticeMoveListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new moves are added
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [moveHistory.length]);

  // Group moves into paired rows (white + black per row)
  const moveRows: {
    moveNumber: number;
    whiteMove: Move | null;
    blackMove: Move | null;
    whiteMoveIndex: number | null;
    blackMoveIndex: number | null;
  }[] = [];

  // Determine the move number from the FEN
  // The first move's before field contains the FEN which has the move number
  const firstMoveBefore = moveHistory[0]?.before;
  let baseMoveNumber = 1;
  if (firstMoveBefore) {
    const parts = firstMoveBefore.split(" ");
    baseMoveNumber = parseInt(parts[5] || "1", 10);
  }

  let plyOffset = 0;

  if (startingSide === "b") {
    // First move is black's
    const firstMove = moveHistory[0];
    if (firstMove) {
      moveRows.push({
        moveNumber: baseMoveNumber,
        whiteMove: null,
        blackMove: firstMove,
        whiteMoveIndex: null,
        blackMoveIndex: 0,
      });
      plyOffset = 1;
    }
  }

  for (let i = plyOffset; i < moveHistory.length; i += 2) {
    const whiteMove = moveHistory[i] || null;
    const blackMove = moveHistory[i + 1] || null;
    const moveNum =
      baseMoveNumber +
      Math.floor((i - plyOffset) / 2) +
      (plyOffset > 0 ? 1 : 0);

    moveRows.push({
      moveNumber: moveNum,
      whiteMove,
      blackMove,
      whiteMoveIndex: whiteMove ? i : null,
      blackMoveIndex: blackMove ? i + 1 : null,
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-cb-border">
        <p
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="text-[10px] tracking-[0.3em] uppercase text-amber-400/60"
        >
          Practice Mode
        </p>
        {skillLevel !== undefined && depth !== undefined && (
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-[10px] text-cb-text-muted mt-1"
          >
            ~{600 + skillLevel * 80} ELO &middot; Depth {depth}
          </p>
        )}
      </div>

      {/* Thinking indicator */}
      {isBotThinking && (
        <div className="px-4 py-2 border-b border-cb-border flex items-center gap-2">
          <div className="flex gap-1">
            <div className="w-1.5 h-1.5 bg-amber-400/60 rounded-full animate-pulse" />
            <div
              className="w-1.5 h-1.5 bg-amber-400/60 rounded-full animate-pulse"
              style={{ animationDelay: "0.2s" }}
            />
            <div
              className="w-1.5 h-1.5 bg-amber-400/60 rounded-full animate-pulse"
              style={{ animationDelay: "0.4s" }}
            />
          </div>
          <span
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-amber-400/60 text-xs"
          >
            Engine thinking...
          </span>
        </div>
      )}

      {/* Move list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-cb-text-faint [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-cb-text-faint"
      >
        {/* Column headers */}
        <div className="sticky top-0 z-10 grid grid-cols-[40px_1fr_1fr] gap-1 px-2 py-2 bg-cb-backdrop backdrop-blur-sm border-b border-cb-border">
          <div
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-[10px] text-cb-text-muted uppercase tracking-wider"
          >
            #
          </div>
          <div
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-[10px] text-cb-text-muted uppercase tracking-wider"
          >
            White
          </div>
          <div
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-[10px] text-cb-text-muted uppercase tracking-wider"
          >
            Black
          </div>
        </div>

        <div className="space-y-0.5 p-2">
          {moveRows.map((row, rowIndex) => {
            const isLastRow = rowIndex === moveRows.length - 1;

            return (
              <div
                key={rowIndex}
                className="grid grid-cols-[40px_1fr_1fr] gap-1"
              >
                {/* Move number */}
                <div
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-xs text-cb-text-muted font-mono py-1"
                >
                  {row.moveNumber}.
                </div>

                {/* White's move */}
                {row.whiteMove ? (
                  <div
                    className={cn(
                      "text-xs py-1 px-2 cursor-default",
                      isLastRow && !row.blackMove
                        ? "bg-cb-surface-elevated text-cb-text"
                        : "text-cb-text-secondary"
                    )}
                    style={{ fontFamily: "'Geist', sans-serif" }}
                  >
                    {row.whiteMove.san}
                  </div>
                ) : (
                  <div className="text-xs text-cb-text-faint py-1">...</div>
                )}

                {/* Black's move */}
                {row.blackMove ? (
                  <div
                    className={cn(
                      "text-xs py-1 px-2 cursor-default",
                      isLastRow
                        ? "bg-cb-surface-elevated text-cb-text"
                        : "text-cb-text-secondary"
                    )}
                    style={{ fontFamily: "'Geist', sans-serif" }}
                  >
                    {row.blackMove.san}
                  </div>
                ) : row.whiteMove ? (
                  <div />
                ) : (
                  <div />
                )}
              </div>
            );
          })}

          {/* Empty state */}
          {moveRows.length === 0 && !isBotThinking && (
            <div
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-center text-cb-text-muted py-8 text-sm"
            >
              Make a move to begin
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Game result banner */}
      {gameOver && (
        <div
          className={cn(
            "px-4 py-3 border-t border-cb-border",
            gameResult === "win" && "bg-amber-500/10 border-t-amber-500/30",
            gameResult === "loss" && "bg-cb-hover border-t-cb-border-strong",
            gameResult === "draw" && "bg-cb-hover border-t-cb-border-strong"
          )}
        >
          <p
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className={cn(
              "text-base text-center",
              gameResult === "win" && "text-amber-400",
              gameResult === "loss" && "text-cb-text-secondary",
              gameResult === "draw" && "text-cb-text-secondary"
            )}
          >
            {gameOverReason}
          </p>
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className={cn(
              "text-xs text-center mt-1",
              gameResult === "win" && "text-amber-400/60",
              gameResult === "loss" && "text-cb-text-muted",
              gameResult === "draw" && "text-cb-text-muted"
            )}
          >
            {gameResult === "win" && "You win!"}
            {gameResult === "loss" && "You lost"}
            {gameResult === "draw" && "Game drawn"}
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="p-3 border-t border-cb-border flex flex-col gap-2">
        <button
          onClick={onReset}
          className="w-full px-4 py-2 text-xs tracking-wide border border-amber-500/30 text-amber-400/80 hover:bg-amber-500/10 hover:text-amber-400 transition-colors"
          style={{ fontFamily: "'Geist', sans-serif" }}
        >
          Reset Position
        </button>
        <button
          onClick={onBackToAnalysis}
          className="w-full px-4 py-2 text-xs tracking-wide border border-cb-border text-cb-text-muted hover:text-cb-text-secondary hover:border-cb-border-strong transition-colors"
          style={{ fontFamily: "'Geist', sans-serif" }}
        >
          Back to Analysis
        </button>
      </div>
    </div>
  );
}
