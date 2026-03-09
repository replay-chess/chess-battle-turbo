"use client";

import React, { useEffect, useRef } from "react";
import { Move } from "chess.js";
import { cn } from "../../lib/utils";
import { DivergenceInfo } from "../../lib/hooks/useAnalysisBoard";

interface AnalysisMoveListProps {
  divergences: DivergenceInfo[];
  currentPlyIndex: number;
  onPlyClick: (ply: number) => void;
  moveNumberStart: number;
  startingSide: "w" | "b";
  isLegendMode?: boolean;
  fullLegendMoves?: Move[];
  gameStartPly?: number;
}

export default function AnalysisMoveList({
  divergences,
  currentPlyIndex,
  onPlyClick,
  moveNumberStart,
  startingSide,
  isLegendMode = false,
  fullLegendMoves = [],
  gameStartPly = 0,
}: AnalysisMoveListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToDivider = useRef(false);

  // Auto-scroll to active move
  useEffect(() => {
    if (activeRowRef.current && listRef.current) {
      activeRowRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [currentPlyIndex]);

  // On initial render in legend mode, scroll to the game start divider
  useEffect(() => {
    if (isLegendMode && dividerRef.current && listRef.current && !hasScrolledToDivider.current) {
      hasScrolledToDivider.current = true;
      dividerRef.current.scrollIntoView({
        behavior: "instant",
        block: "center",
      });
    }
  }, [isLegendMode]);

  // Reset scroll flag when leaving legend mode
  useEffect(() => {
    if (!isLegendMode) {
      hasScrolledToDivider.current = false;
    }
  }, [isLegendMode]);

  if (isLegendMode && fullLegendMoves.length > 0) {
    return (
      <LegendFullMoveList
        listRef={listRef}
        activeRowRef={activeRowRef}
        dividerRef={dividerRef}
        fullLegendMoves={fullLegendMoves}
        gameStartPly={gameStartPly}
        currentPlyIndex={currentPlyIndex}
        onPlyClick={onPlyClick}
      />
    );
  }

  return (
    <ComparisonMoveList
      listRef={listRef}
      activeRowRef={activeRowRef}
      divergences={divergences}
      currentPlyIndex={currentPlyIndex}
      onPlyClick={onPlyClick}
      moveNumberStart={moveNumberStart}
      startingSide={startingSide}
    />
  );
}

// --- Legend Full Game Move List ---

interface LegendFullMoveListProps {
  listRef: React.RefObject<HTMLDivElement | null>;
  activeRowRef: React.RefObject<HTMLDivElement | null>;
  dividerRef: React.RefObject<HTMLDivElement | null>;
  fullLegendMoves: Move[];
  gameStartPly: number;
  currentPlyIndex: number;
  onPlyClick: (ply: number) => void;
}

function LegendFullMoveList({
  listRef,
  activeRowRef,
  dividerRef,
  fullLegendMoves,
  gameStartPly,
  currentPlyIndex,
  onPlyClick,
}: LegendFullMoveListProps) {
  // The absolute ply currently active (in terms of full game)
  const activePly = gameStartPly + currentPlyIndex;

  // Build rows: each row = one full move (white + black)
  const moveRows: {
    moveNumber: number;
    whiteMove: Move | null;
    blackMove: Move | null;
    whiteAbsolutePly: number;
    blackAbsolutePly: number;
  }[] = [];

  for (let i = 0; i < fullLegendMoves.length; i += 2) {
    const whiteMove = fullLegendMoves[i] || null;
    const blackMove = fullLegendMoves[i + 1] || null;
    moveRows.push({
      moveNumber: Math.floor(i / 2) + 1,
      whiteMove,
      blackMove,
      whiteAbsolutePly: i + 1,
      blackAbsolutePly: i + 2,
    });
  }

  // Determine which row the divider goes before
  // The divider marks where the user's game started
  // gameStartPly is the number of moves before the game start
  // The row containing gameStartPly: Math.floor(gameStartPly / 2)
  const dividerBeforeRow = gameStartPly > 0 ? Math.floor(gameStartPly / 2) : -1;

  return (
    <div
      ref={listRef}
      className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 grid grid-cols-[40px_1fr_1fr] gap-1 px-2 py-2 bg-black/80 backdrop-blur-sm border-b border-white/10">
        <div className="text-[10px] text-white/40 uppercase tracking-wider">#</div>
        <div className="text-[10px] text-white/40 uppercase tracking-wider">
          White
        </div>
        <div className="text-[10px] text-white/40 uppercase tracking-wider">
          Black
        </div>
      </div>

      {/* Move rows */}
      <div className="space-y-0.5 p-2">
        {moveRows.map((row, rowIndex) => {
          const whiteIsActive = row.whiteMove && activePly === row.whiteAbsolutePly;
          const blackIsActive = row.blackMove && activePly === row.blackAbsolutePly;
          const isActive = whiteIsActive || blackIsActive;

          const whiteIsPreGame = row.whiteAbsolutePly <= gameStartPly;
          const blackIsPreGame = row.blackAbsolutePly <= gameStartPly;

          // Show divider before the row that contains the game start ply
          const showDivider = rowIndex === dividerBeforeRow;

          return (
            <React.Fragment key={rowIndex}>
              {showDivider && (
                <div ref={dividerRef} className="relative my-3 flex items-center">
                  <div className="flex-1 border-t border-dashed border-amber-400/30" />
                  <span
                    className="px-2 text-[9px] text-amber-400/50 uppercase tracking-wider whitespace-nowrap"
                    style={{ fontFamily: "'Geist', sans-serif" }}
                  >
                    Game started here
                  </span>
                  <div className="flex-1 border-t border-dashed border-amber-400/30" />
                </div>
              )}
              <div
                ref={isActive ? activeRowRef : null}
                className="grid grid-cols-[40px_1fr_1fr] gap-1"
              >
                {/* Move number */}
                <div className={cn(
                  "text-xs font-mono py-1",
                  whiteIsPreGame && blackIsPreGame ? "text-white/20" : "text-white/30"
                )}>
                  {row.moveNumber}.
                </div>

                {/* White's move */}
                {row.whiteMove ? (
                  <LegendMoveCell
                    san={row.whiteMove.san}
                    isActive={!!whiteIsActive}
                    isPreGame={whiteIsPreGame}
                    onClick={() => onPlyClick(row.whiteAbsolutePly - gameStartPly)}
                  />
                ) : (
                  <div />
                )}

                {/* Black's move */}
                {row.blackMove ? (
                  <LegendMoveCell
                    san={row.blackMove.san}
                    isActive={!!blackIsActive}
                    isPreGame={blackIsPreGame}
                    onClick={() => onPlyClick(row.blackAbsolutePly - gameStartPly)}
                  />
                ) : (
                  <div />
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

interface LegendMoveCellProps {
  san: string;
  isActive: boolean;
  isPreGame: boolean;
  onClick: () => void;
}

function LegendMoveCell({ san, isActive, isPreGame, onClick }: LegendMoveCellProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "py-1 px-1.5 rounded cursor-pointer transition-all duration-150",
        isActive && "bg-sky-500/20 ring-1 ring-sky-400/30",
        !isActive && "hover:bg-white/5"
      )}
    >
      <div
        className={cn(
          "text-xs font-mono truncate",
          isPreGame ? "text-sky-300/40" : "text-sky-300/70"
        )}
      >
        {san}
      </div>
    </div>
  );
}

// --- Comparison Move List (original behavior) ---

interface ComparisonMoveListProps {
  listRef: React.RefObject<HTMLDivElement | null>;
  activeRowRef: React.RefObject<HTMLDivElement | null>;
  divergences: DivergenceInfo[];
  currentPlyIndex: number;
  onPlyClick: (ply: number) => void;
  moveNumberStart: number;
  startingSide: "w" | "b";
}

function ComparisonMoveList({
  listRef,
  activeRowRef,
  divergences,
  currentPlyIndex,
  onPlyClick,
  moveNumberStart,
  startingSide,
}: ComparisonMoveListProps) {
  // Group moves into pairs (full moves)
  const moveRows: {
    moveNumber: number;
    whitePly: DivergenceInfo | null;
    blackPly: DivergenceInfo | null;
  }[] = [];

  let plyOffset = 0;

  // If starting side is black, first move is black's
  if (startingSide === "b") {
    // First move is black
    const firstMove = divergences[0];
    if (firstMove) {
      moveRows.push({
        moveNumber: moveNumberStart,
        whitePly: null,
        blackPly: firstMove,
      });
      plyOffset = 1;
    }
  }

  // Group remaining moves into pairs
  for (let i = plyOffset; i < divergences.length; i += 2) {
    const whitePly = divergences[i] || null;
    const blackPly = divergences[i + 1] || null;
    const moveNum =
      moveNumberStart + Math.floor((i - plyOffset) / 2) + (plyOffset > 0 ? 1 : 0);

    moveRows.push({
      moveNumber: moveNum,
      whitePly,
      blackPly,
    });
  }

  return (
    <div
      ref={listRef}
      className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 grid grid-cols-[40px_1fr_1fr] gap-1 px-2 py-2 bg-black/80 backdrop-blur-sm border-b border-white/10">
        <div className="text-[10px] text-white/40 uppercase tracking-wider">#</div>
        <div className="text-[10px] text-white/40 uppercase tracking-wider">
          White
        </div>
        <div className="text-[10px] text-white/40 uppercase tracking-wider">
          Black
        </div>
      </div>

      {/* Move rows */}
      <div className="space-y-0.5 p-2">
        {moveRows.map((row, rowIndex) => {
          const whiteIsActive =
            row.whitePly && currentPlyIndex === row.whitePly.plyIndex;
          const blackIsActive =
            row.blackPly && currentPlyIndex === row.blackPly.plyIndex;
          const isActive = whiteIsActive || blackIsActive;

          return (
            <div
              key={rowIndex}
              ref={isActive ? activeRowRef : null}
              className="grid grid-cols-[40px_1fr_1fr] gap-1"
            >
              {/* Move number */}
              <div className="text-xs text-white/30 font-mono py-1">
                {row.moveNumber}.
              </div>

              {/* White's move */}
              {row.whitePly ? (
                <MoveCell
                  divergence={row.whitePly}
                  isActive={whiteIsActive || false}
                  onClick={() => onPlyClick(row.whitePly!.plyIndex)}
                />
              ) : (
                <div className="text-xs text-white/20 py-1">...</div>
              )}

              {/* Black's move */}
              {row.blackPly ? (
                <MoveCell
                  divergence={row.blackPly}
                  isActive={blackIsActive || false}
                  onClick={() => onPlyClick(row.blackPly!.plyIndex)}
                />
              ) : (
                <div />
              )}
            </div>
          );
        })}

        {/* Empty state */}
        {moveRows.length === 0 && (
          <div className="text-center text-white/40 py-8 text-sm">
            No moves to display
          </div>
        )}
      </div>
    </div>
  );
}

interface MoveCellProps {
  divergence: DivergenceInfo;
  isActive: boolean;
  onClick: () => void;
}

function MoveCell({ divergence, isActive, onClick }: MoveCellProps) {
  const { userMove, isDivergent } = divergence;

  return (
    <div
      onClick={onClick}
      className={cn(
        "py-1 px-1.5 rounded cursor-pointer transition-all duration-150",
        isActive && "bg-emerald-500/20 ring-1 ring-emerald-400/30",
        !isActive && "hover:bg-white/5",
        isDivergent && "bg-amber-500/10"
      )}
    >
      <div
        className={cn(
          "text-xs font-mono truncate",
          userMove ? "text-emerald-300/70" : "text-white/20"
        )}
      >
        {userMove?.san || "-"}
      </div>
    </div>
  );
}
