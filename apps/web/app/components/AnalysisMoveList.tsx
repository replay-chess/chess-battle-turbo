"use client";

import React, { useEffect, useRef } from "react";
import { Move } from "chess.js";
import { cn } from "../../lib/utils";

interface AnalysisMoveListProps {
  userMoves: Move[];
  currentPlyIndex: number;
  onPlyClick: (ply: number) => void;
  moveNumberStart: number;
  startingSide: "w" | "b";
  isLegendMode?: boolean;
  fullLegendMoves?: Move[];
  gameStartPly?: number;
}

export default function AnalysisMoveList({
  userMoves,
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
    <UserMoveList
      listRef={listRef}
      activeRowRef={activeRowRef}
      userMoves={userMoves}
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

// --- User Move List (Your Moves tab) ---

interface UserMoveListProps {
  listRef: React.RefObject<HTMLDivElement | null>;
  activeRowRef: React.RefObject<HTMLDivElement | null>;
  userMoves: Move[];
  currentPlyIndex: number;
  onPlyClick: (ply: number) => void;
  moveNumberStart: number;
  startingSide: "w" | "b";
}

function UserMoveList({
  listRef,
  activeRowRef,
  userMoves,
  currentPlyIndex,
  onPlyClick,
  moveNumberStart,
  startingSide,
}: UserMoveListProps) {
  // Group moves into pairs (full moves)
  const moveRows: {
    moveNumber: number;
    whiteMove: Move | null;
    blackMove: Move | null;
    whitePlyIndex: number;
    blackPlyIndex: number;
  }[] = [];

  let plyOffset = 0;

  // If starting side is black, first move is black's
  if (startingSide === "b") {
    const firstMove = userMoves[0];
    if (firstMove) {
      moveRows.push({
        moveNumber: moveNumberStart,
        whiteMove: null,
        blackMove: firstMove,
        whitePlyIndex: 0,
        blackPlyIndex: 1,
      });
      plyOffset = 1;
    }
  }

  // Group remaining moves into pairs
  for (let i = plyOffset; i < userMoves.length; i += 2) {
    const whiteMove = userMoves[i] || null;
    const blackMove = userMoves[i + 1] || null;
    const moveNum =
      moveNumberStart + Math.floor((i - plyOffset) / 2) + (plyOffset > 0 ? 1 : 0);

    moveRows.push({
      moveNumber: moveNum,
      whiteMove,
      blackMove,
      whitePlyIndex: i + 1,
      blackPlyIndex: i + 2,
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
          const whiteIsActive = row.whiteMove && currentPlyIndex === row.whitePlyIndex;
          const blackIsActive = row.blackMove && currentPlyIndex === row.blackPlyIndex;
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
              {row.whiteMove ? (
                <UserMoveCell
                  san={row.whiteMove.san}
                  isActive={!!whiteIsActive}
                  onClick={() => onPlyClick(row.whitePlyIndex)}
                />
              ) : (
                <div className="text-xs text-white/20 py-1">...</div>
              )}

              {/* Black's move */}
              {row.blackMove ? (
                <UserMoveCell
                  san={row.blackMove.san}
                  isActive={!!blackIsActive}
                  onClick={() => onPlyClick(row.blackPlyIndex)}
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

interface UserMoveCellProps {
  san: string;
  isActive: boolean;
  onClick: () => void;
}

function UserMoveCell({ san, isActive, onClick }: UserMoveCellProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "py-1 px-1.5 rounded cursor-pointer transition-all duration-150",
        isActive && "bg-white/10 ring-1 ring-white/20",
        !isActive && "hover:bg-white/5"
      )}
    >
      <div className="text-xs font-mono truncate text-white/70">
        {san}
      </div>
    </div>
  );
}
