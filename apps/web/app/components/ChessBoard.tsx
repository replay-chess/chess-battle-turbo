import React from "react";
import { cn } from "../../lib/utils";
import { Chess, Color, PieceSymbol, Square } from "chess.js";
import Image from "next/image";
import { DefeatOverlay, DrawOverlay, GameResultBanner } from "./GameEndEffects";

type PieceInfo = {
  square: Square;
  type: PieceSymbol;
  color: Color;
} | null;

// Static size configuration — never depends on props/state
const sizeConfig = {
  sm: "w-8 h-8 sm:w-9 sm:h-9",
  md: "w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14",
  lg: "w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 lg:w-16 lg:h-16",
  // Responsive: fills container width on phones (<640px), fixed on sm+
  "responsive-lg": "flex-1 aspect-square sm:flex-none sm:aspect-auto sm:w-12 sm:h-12 md:w-14 md:h-14 lg:w-16 lg:h-16",
  "responsive-md": "flex-1 aspect-square sm:flex-none sm:aspect-auto sm:w-12 sm:h-12 md:w-14 md:h-14",
} as const;

// Static arrays for square notation conversion
const fileArr = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const rankArr = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;

type ChessProps = {
  board?: PieceInfo[][];
  squareSize?: keyof typeof sizeConfig;
  selectedSquare?: Square | null;
  legalMoves?: Square[];
  onSquareClick?: (square: Square) => void;
  isInteractive?: boolean;
  playerColor?: Color | null;
  showCoordinates?: boolean;
  lastMove?: { from: Square; to: Square } | null;
  gameEndState?: "victory" | "defeat" | "draw" | "white_wins" | "black_wins" | null;
  // Faded mode for showing legend's board at normal size with reduced opacity
  fadedPieces?: boolean;
};

const ChessBoard = ({
  board = new Chess().board(),
  squareSize = "lg",
  selectedSquare = null,
  legalMoves = [],
  onSquareClick,
  isInteractive = true,
  playerColor = "w",
  showCoordinates = true,
  lastMove = null,
  gameEndState = null,
  fadedPieces = false,
}: ChessProps) => {
  // Flip the board if player is black
  const displayBoard =
    playerColor === "b"
      ? [...board].reverse().map((row) => [...row].reverse())
      : board;

  const files = playerColor === "b"
    ? ["h", "g", "f", "e", "d", "c", "b", "a"]
    : ["a", "b", "c", "d", "e", "f", "g", "h"];

  const ranks = playerColor === "b"
    ? ["1", "2", "3", "4", "5", "6", "7", "8"]
    : ["8", "7", "6", "5", "4", "3", "2", "1"];

  // Convert row and column index to chess square notation
  const getSquareNotation = (
    rowIndex: number,
    columnIndex: number
  ): Square => {
    let adjustedRow = rowIndex;
    let adjustedCol = columnIndex;

    if (playerColor === "b") {
      adjustedRow = 7 - rowIndex;
      adjustedCol = 7 - columnIndex;
    }

    return `${fileArr[adjustedCol]}${rankArr[adjustedRow]}` as Square;
  };

  const isSquareSelected = (rowIndex: number, columnIndex: number): boolean => {
    return selectedSquare === getSquareNotation(rowIndex, columnIndex);
  };

  const isSquareLegalMove = (rowIndex: number, columnIndex: number): boolean => {
    return legalMoves.includes(getSquareNotation(rowIndex, columnIndex));
  };

  const isLastMoveSquare = (rowIndex: number, columnIndex: number): boolean => {
    if (!lastMove) return false;
    const notation = getSquareNotation(rowIndex, columnIndex);
    return notation === lastMove.from || notation === lastMove.to;
  };

  const isLightSquare = (rowIndex: number, columnIndex: number): boolean => {
    return (rowIndex + columnIndex) % 2 === 0;
  };

  const isResponsive = squareSize === "responsive-lg" || squareSize === "responsive-md";

  return (
    <div className="flex items-center justify-center w-full select-none">
      {/* Board with outer frames */}
      <div className={cn("relative", isResponsive && "w-full sm:w-auto")}>
        {/* Outer decorative frame — hidden on mobile for responsive sizes */}
        <div className={cn(
          "absolute -inset-4 border border-white/10",
          isResponsive && "hidden sm:block"
        )} />

        {/* Main board container */}
        <div className={cn(
          "relative border border-white/20 shadow-2xl shadow-black/80",
          gameEndState === "defeat" && "transition-all duration-1000"
        )}>
          {/* Game end overlays */}
          <DefeatOverlay isActive={gameEndState === "defeat"} />
          <DrawOverlay isActive={gameEndState === "draw"} />
          <GameResultBanner gameEndState={gameEndState} />
          {/* The board itself */}
          {displayBoard.map((row, rowIndex) => (
            <div key={rowIndex} className={cn("flex", isResponsive && "w-full")}>
              {row.map((square, columnIndex) => {
                const squareNotation = getSquareNotation(rowIndex, columnIndex);
                const isSelected = isSquareSelected(rowIndex, columnIndex);
                const isLegalMove = isSquareLegalMove(rowIndex, columnIndex);
                const isLastMove = isLastMoveSquare(rowIndex, columnIndex);
                const isLight = isLightSquare(rowIndex, columnIndex);
                const hasPiece = square !== null;

                // Show file letter on bottom row (row 7)
                const showFile = showCoordinates && rowIndex === 7;
                // Show rank number on first column (column 0)
                const showRank = showCoordinates && columnIndex === 0;

                return (
                  <div
                    key={columnIndex}
                    data-square={squareNotation}
                    onClick={() => isInteractive && onSquareClick?.(squareNotation)}
                    className={cn(
                      sizeConfig[squareSize],
                      "relative flex items-center justify-center",
                      "transition-all duration-150",
                      isInteractive && "cursor-pointer",
                      // Base square colors with subtle gradients
                      isLight
                        ? "bg-gradient-to-br from-neutral-200 via-neutral-100 to-neutral-200"
                        : "bg-gradient-to-br from-neutral-800 via-neutral-900 to-neutral-800"
                    )}
                    style={{
                      boxShadow: isLight
                        ? "inset 1px 1px 2px rgba(0,0,0,0.08), inset -1px -1px 1px rgba(255,255,255,0.9)"
                        : "inset 1px 1px 3px rgba(0,0,0,0.4), inset -1px -1px 2px rgba(255,255,255,0.05)",
                    }}
                  >
                    {/* Coordinate: Rank number (top-left corner) */}
                    {showRank && (
                      <span
                        className={cn(
                          "absolute top-0.5 left-0.5 text-[7px] sm:text-[8px] font-medium leading-none select-none",
                          isLight ? "text-neutral-500/70" : "text-neutral-400/70"
                        )}
                        style={{ fontFamily: "'Geist', sans-serif" }}
                      >
                        {ranks[rowIndex]}
                      </span>
                    )}

                    {/* Coordinate: File letter (bottom-right corner) */}
                    {showFile && (
                      <span
                        className={cn(
                          "absolute bottom-0.5 right-0.5 text-[7px] sm:text-[8px] font-medium leading-none select-none",
                          isLight ? "text-neutral-500/70" : "text-neutral-400/70"
                        )}
                        style={{ fontFamily: "'Geist', sans-serif" }}
                      >
                        {files[columnIndex]}
                      </span>
                    )}

                    {/* Last move highlight */}
                    {isLastMove && (
                      <div
                        className={cn(
                          "absolute inset-0 z-0",
                          isLight
                            ? "bg-amber-300/30"
                            : "bg-amber-500/25"
                        )}
                      />
                    )}

                    {/* Selected square highlight */}
                    {isSelected && (
                      <div
                        className={cn(
                          "absolute inset-0 z-10",
                          isLight
                            ? "bg-amber-200/40 ring-1 ring-inset ring-amber-400/50"
                            : "bg-amber-400/25 ring-1 ring-inset ring-amber-300/40"
                        )}
                      />
                    )}

                    {/* Legal move indicator */}
                    {isLegalMove && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center">
                        {hasPiece ? (
                          // Capture indicator - subtle corner triangles (same color on all squares)
                          <>
                            <div
                              className="absolute top-0 left-0 w-0 h-0 border-[8px] sm:border-[10px] border-r-transparent border-b-transparent"
                              style={{ borderTopColor: 'rgba(220, 80, 80, 0.45)', borderLeftColor: 'rgba(220, 80, 80, 0.45)' }}
                            />
                            <div
                              className="absolute bottom-0 right-0 w-0 h-0 border-[8px] sm:border-[10px] border-l-transparent border-t-transparent"
                              style={{ borderBottomColor: 'rgba(220, 80, 80, 0.45)', borderRightColor: 'rgba(220, 80, 80, 0.45)' }}
                            />
                          </>
                        ) : (
                          // Move indicator - elegant dot
                          <div
                            className={cn(
                              "w-3 h-3 sm:w-4 sm:h-4 rounded-full",
                              isLight
                                ? "bg-neutral-900/25"
                                : "bg-white/25"
                            )}
                          />
                        )}
                      </div>
                    )}

                    {/* Chess piece */}
                    {square !== null && (
                      <div
                        className={cn(
                          "relative z-20 w-[85%] h-[85%]",
                          "transition-transform duration-100",
                          isInteractive && "hover:scale-105",
                          isSelected && "scale-105"
                        )}
                        style={fadedPieces ? { opacity: 0.8 } : undefined}
                      >
                        <Image
                          src={`/chess-icons/${square.color}${square.type}.png`}
                          alt={`${square.color === "w" ? "White" : "Black"} ${square.type}`}
                          width={100}
                          height={100}
                          className={cn(
                            "w-full h-full object-contain",
                            square.color === "w"
                              ? "drop-shadow-[0_2px_3px_rgba(0,0,0,0.3)]"
                              : "drop-shadow-[0_2px_3px_rgba(0,0,0,0.5)]"
                          )}
                          draggable={false}
                        />
                      </div>
                    )}

                    {/* Hover state for interactive squares */}
                    {isInteractive && !isSelected && (
                      <div
                        className={cn(
                          "absolute inset-0 z-5 opacity-0 hover:opacity-100",
                          "transition-opacity duration-150",
                          isLight
                            ? "bg-black/5"
                            : "bg-white/5"
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ChessBoard;
