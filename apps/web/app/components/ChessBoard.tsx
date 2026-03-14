import React, { useRef, useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import { Chess, Color, PieceSymbol, Square } from "chess.js";
import Image from "next/image";
import { DefeatOverlay, DrawOverlay, GameResultBanner } from "./GameEndEffects";

// Highlight color palette — soothing, semi-transparent for chess analysis
// green:  strong squares, good moves, piece activity
// red:    threats, weaknesses, hanging pieces
// blue:   defensive ideas, safe squares, king safety
// orange: tension, critical squares, key decisions
// purple: alternative plans, prophylaxis, long-term ideas
const highlightColorMap: Record<string, { light: string; dark: string }> = {
  green:  { light: "rgba(110, 187, 140, 0.40)", dark: "rgba(110, 187, 140, 0.30)" },
  red:    { light: "rgba(210, 120, 110, 0.38)", dark: "rgba(210, 120, 110, 0.28)" },
  blue:   { light: "rgba(120, 160, 210, 0.38)", dark: "rgba(120, 160, 210, 0.28)" },
  orange: { light: "rgba(220, 170, 100, 0.40)", dark: "rgba(220, 170, 100, 0.30)" },
  purple: { light: "rgba(170, 130, 200, 0.35)", dark: "rgba(170, 130, 200, 0.25)" },
  yellow: { light: "rgba(235, 185, 60, 0.38)",  dark: "rgba(235, 185, 60, 0.28)" },
};

const defaultHighlight = { light: "rgba(235, 185, 60, 0.38)", dark: "rgba(235, 185, 60, 0.28)" };

// Arrow fill — default warm yellow, per-color overrides
const arrowFill = {
  shaft: "rgba(251, 191, 36, 0.45)",
  head: "rgba(251, 191, 36, 0.55)",
} as const;

const arrowColorMap: Record<string, { shaft: string; head: string }> = {
  green:  { shaft: "rgba(110, 187, 140, 0.50)", head: "rgba(110, 187, 140, 0.65)" },
  red:    { shaft: "rgba(210, 120, 110, 0.50)", head: "rgba(210, 120, 110, 0.65)" },
  blue:   { shaft: "rgba(120, 160, 210, 0.50)", head: "rgba(120, 160, 210, 0.65)" },
  orange: { shaft: "rgba(220, 170, 100, 0.50)", head: "rgba(220, 170, 100, 0.65)" },
  purple: { shaft: "rgba(170, 130, 200, 0.45)", head: "rgba(170, 130, 200, 0.60)" },
  yellow: { shaft: "rgba(251, 191, 36, 0.45)", head: "rgba(251, 191, 36, 0.55)" },
};

type HighlightColor = string;

export interface HighlightGroup {
  squares: Square[];
  color: HighlightColor;
}

export interface ArrowData {
  from: Square;
  to: Square;
  color: HighlightColor;
}

export interface SquareAnnotation {
  square: Square;
  symbol: string;
  icon?: string;
  color?: string;
}

// Annotation badge styles — chess.com inspired
const annotationStyles: Record<string, { bg: string; text: string; label: string }> = {
  "!!":        { bg: "bg-cyan-400",    text: "text-cyan-950",   label: "!!" },
  "!":         { bg: "bg-blue-400",    text: "text-blue-950",   label: "!" },
  "best":      { bg: "bg-emerald-400", text: "text-emerald-950", label: "★" },
  "excellent": { bg: "bg-green-400",   text: "text-green-950",  label: "✓" },
  "good":      { bg: "bg-lime-400",    text: "text-lime-950",   label: "○" },
  "book":      { bg: "bg-amber-600",   text: "text-amber-50",   label: "B" },
  "?!":        { bg: "bg-yellow-400",  text: "text-yellow-950", label: "?!" },
  "?":         { bg: "bg-orange-400",  text: "text-orange-950", label: "?" },
  "??":        { bg: "bg-red-500",     text: "text-white",      label: "??" },
  "miss":      { bg: "bg-rose-500",    text: "text-white",      label: "✕" },
};
const defaultAnnotation = { bg: "bg-neutral-500", text: "text-white", label: "·" };

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
  "responsive-lg": "flex-1 aspect-square sm:flex-none sm:aspect-auto sm:w-12 sm:h-12 md:w-20 md:h-20 lg:w-16 lg:h-16",
  "responsive-md": "flex-1 aspect-square sm:flex-none sm:aspect-auto sm:w-12 sm:h-12 md:w-18 md:h-18",
} as const;

// Static arrays for square notation conversion
const fileArr = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const rankArr = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;

// Minimum pixel distance before a pointerdown becomes a drag
const DRAG_THRESHOLD = 4;

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
  // Explanation overlays
  highlights?: HighlightGroup[];
  arrows?: ArrowData[];
  annotations?: SquareAnnotation[];
  // Animated piece sliding overlay
  animatingMove?: {
    piece: { type: PieceSymbol; color: Color };
    from: Square;
    to: Square;
  } | null;
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
  highlights = [],
  arrows = [],
  annotations = [],
  animatingMove = null,
}: ChessProps) => {
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const animOverlayRef = useRef<HTMLDivElement>(null);
  const dragGhostRef = useRef<HTMLDivElement>(null);
  const dragInfoRef = useRef<{
    startClientX: number;
    startClientY: number;
    piece: { type: PieceSymbol; color: Color };
    sourceSquare: Square;
    pointerId: number;
  } | null>(null);
  const [boardPixelSize, setBoardPixelSize] = useState(0);
  const [dragState, setDragState] = useState<{
    piece: { type: PieceSymbol; color: Color };
    sourceSquare: Square;
    x: number;
    y: number;
  } | null>(null);
  // Prevents the square onClick from double-firing after pointerup already handled the click
  const suppressClickRef = useRef(false);

  // Native capture-phase click handler: intercepts spurious click events that fire
  // after pointerup already handled the interaction. stopPropagation in capture phase
  // prevents the event from reaching React's bubble-phase onClick on the square div.
  useEffect(() => {
    const board = boardContainerRef.current;
    if (!board) return;
    const handler = (e: MouseEvent) => {
      if (suppressClickRef.current) {
        e.stopPropagation();
        suppressClickRef.current = false;
      }
    };
    board.addEventListener("click", handler, true);
    return () => board.removeEventListener("click", handler, true);
  }, []);

  // Measure the board container for SVG arrows and piece animation overlay
  useEffect(() => {
    if (!boardContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setBoardPixelSize(entry.contentRect.width);
      }
    });
    observer.observe(boardContainerRef.current);
    return () => observer.disconnect();
  }, []);

  // Animate the overlay piece from source to destination square
  useEffect(() => {
    const el = animOverlayRef.current;
    if (!animatingMove || !el || boardPixelSize === 0) return;

    const sqSize = boardPixelSize / 8;
    const pieceSize = sqSize * 0.85;

    const getPos = (sq: Square) => {
      const f = sq.charCodeAt(0) - 97;
      const r = parseInt(sq[1]!) - 1;
      let col = f, row = 7 - r;
      if (playerColor === "b") { col = 7 - f; row = r; }
      return {
        x: (col + 0.5) * sqSize - pieceSize / 2,
        y: (row + 0.5) * sqSize - pieceSize / 2,
      };
    };

    const fromPos = getPos(animatingMove.from);
    const toPos = getPos(animatingMove.to);

    // Set start position without transition
    el.style.transition = "none";
    el.style.transform = `translate(${fromPos.x}px, ${fromPos.y}px)`;
    el.getBoundingClientRect(); // force reflow
    // Animate to destination
    el.style.transition = "transform 500ms cubic-bezier(0.25, 0.1, 0.25, 1)";
    el.style.transform = `translate(${toPos.x}px, ${toPos.y}px)`;
  }, [animatingMove, boardPixelSize, playerColor]);

  // --- Drag-and-drop handlers ---

  const handlePiecePointerDown = (
    e: React.PointerEvent,
    piece: { type: PieceSymbol; color: Color },
    sourceSquare: Square
  ) => {
    if (!isInteractive || !onSquareClick || e.button !== 0) return;
    if (dragInfoRef.current) return; // prevent multi-touch conflicts
    // Prevent compatibility mouse events (mousedown/mouseup/click) so the
    // square div's onClick doesn't double-fire — we handle it in pointerup.
    e.preventDefault();
    dragInfoRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      piece,
      sourceSquare,
      pointerId: e.pointerId,
    };
    boardContainerRef.current?.setPointerCapture(e.pointerId);
  };

  const handleBoardPointerMove = (e: React.PointerEvent) => {
    const info = dragInfoRef.current;
    if (!info) return;
    const container = boardContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();

    if (!dragState) {
      // Not yet dragging — check threshold
      const dx = e.clientX - info.startClientX;
      const dy = e.clientY - info.startClientY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      // Start drag: select the source square
      onSquareClick?.(info.sourceSquare);
      setDragState({
        piece: info.piece,
        sourceSquare: info.sourceSquare,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    } else {
      // Already dragging — update ghost position via ref (no re-render)
      if (dragGhostRef.current) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const sqSize = rect.width / 8;
        const pieceSize = sqSize * 0.95;
        dragGhostRef.current.style.transform = `translate(${x - pieceSize / 2}px, ${y - pieceSize / 2}px)`;
      }
    }
  };

  const handleBoardPointerUp = (e: React.PointerEvent) => {
    const info = dragInfoRef.current;
    if (!info) return;

    const container = boardContainerRef.current;

    if (dragState && container) {
      const rect = container.getBoundingClientRect();
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;

      // Check if pointer is within the board
      if (pointerX >= 0 && pointerX < rect.width && pointerY >= 0 && pointerY < rect.height) {
        const sqSize = rect.width / 8;
        const col = Math.floor(pointerX / sqSize);
        const row = Math.floor(pointerY / sqSize);
        let file: number, rank: number;
        if (playerColor === "b") {
          file = 7 - col;
          rank = row;
        } else {
          file = col;
          rank = 7 - row;
        }
        const targetSquare = `${fileArr[file]}${rank + 1}` as Square;
        onSquareClick?.(targetSquare);
      } else {
        // Pointer outside board — deselect by clicking source again
        onSquareClick?.(info.sourceSquare);
      }
    } else {
      // No drag occurred — this was a click on a piece.
      // setPointerCapture redirected pointerup here, suppressing the
      // normal click event on the square div, so fire it manually.
      // Suppress any onClick that fires in the same event batch (browsers that
      // don't fully suppress click after e.preventDefault() on pointerdown).
      // Reset after the current frame so the next deliberate click works.
      suppressClickRef.current = true;
      requestAnimationFrame(() => { suppressClickRef.current = false; });
      onSquareClick?.(info.sourceSquare);
    }

    // Clean up
    if (container) {
      try {
        container.releasePointerCapture(info.pointerId);
      } catch {
        // already released
      }
    }
    dragInfoRef.current = null;
    setDragState(null);
  };

  const handleLostPointerCapture = () => {
    if (dragInfoRef.current) {
      dragInfoRef.current = null;
      setDragState(null);
    }
  };

  // Cancel drag if board becomes non-interactive mid-drag
  useEffect(() => {
    if (!isInteractive && dragInfoRef.current) {
      dragInfoRef.current = null;
      setDragState(null);
    }
  }, [isInteractive]);

  // Helper: get pixel coords for the center of a square
  const getSquareCenter = (sq: Square): { x: number; y: number } => {
    const file = sq.charCodeAt(0) - 97; // a=0, h=7
    const rank = parseInt(sq[1]!) - 1;   // 1=0, 8=7
    const sqSize = boardPixelSize / 8;
    let col = file;
    let row = 7 - rank;
    if (playerColor === "b") {
      col = 7 - file;
      row = rank;
    }
    return { x: (col + 0.5) * sqSize, y: (row + 0.5) * sqSize };
  };

  // Build a set of highlighted squares with their colors for quick lookup
  const highlightMap = new Map<string, HighlightColor>();
  for (const group of highlights) {
    for (const sq of group.squares) {
      highlightMap.set(sq, group.color);
    }
  }

  // Build annotation lookup
  const annotationMap = new Map<string, SquareAnnotation>();
  for (const ann of annotations) {
    annotationMap.set(ann.square, ann);
  }
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
        <div
          ref={boardContainerRef}
          onPointerMove={handleBoardPointerMove}
          onPointerUp={handleBoardPointerUp}
          onLostPointerCapture={handleLostPointerCapture}
          className={cn(
            "relative border border-white/20 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)]",
            gameEndState === "defeat" && "transition-all duration-1000"
          )}
          style={isInteractive ? { touchAction: "none" } : undefined}
        >
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

                    {/* Explanation highlight overlay */}
                    {highlightMap.has(squareNotation) && (() => {
                      const hlColor = highlightColorMap[highlightMap.get(squareNotation)!] ?? defaultHighlight;
                      return (
                        <div
                          className="absolute inset-0 z-[1]"
                          style={{ backgroundColor: isLight ? hlColor.light : hlColor.dark }}
                        />
                      );
                    })()}

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
                    {square !== null && (() => {
                      const isAnimatingTo = animatingMove?.to === squareNotation;
                      const isDragSource = dragState?.sourceSquare === squareNotation;
                      return (
                      <div
                        onPointerDown={(e) =>
                          handlePiecePointerDown(e, { type: square.type, color: square.color }, squareNotation)
                        }
                        className={cn(
                          "relative z-20 w-[85%] h-[85%]",
                          "transition-transform duration-100",
                          isInteractive && "hover:scale-105",
                          isSelected && "scale-105"
                        )}
                        style={
                          isDragSource
                            ? { opacity: 0.3 }
                            : isAnimatingTo
                              ? { opacity: 0 }
                              : fadedPieces
                                ? { opacity: 0.8 }
                                : undefined
                        }
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
                      );
                    })()}

                    {/* Annotation badge */}
                    {annotationMap.has(squareNotation) && (() => {
                      const ann = annotationMap.get(squareNotation)!;
                      if (ann.icon) {
                        return (
                          <div className="absolute -top-1.5 -right-1.5 z-40 w-5 h-5 sm:w-6 sm:h-6">
                            <Image
                              src={`/board_icons/128x/${ann.icon}`}
                              alt={ann.symbol}
                              width={24}
                              height={24}
                              className="w-full h-full object-contain drop-shadow-md"
                              draggable={false}
                            />
                          </div>
                        );
                      }
                      const style = annotationStyles[ann.symbol] ?? defaultAnnotation;
                      return (
                        <div
                          className={cn(
                            "absolute -top-1 -right-1 z-40 flex items-center justify-center",
                            "w-4 h-4 sm:w-5 sm:h-5 rounded-full shadow-md shadow-black/40",
                            style.bg, style.text
                          )}
                          style={{ fontFamily: "'Geist', sans-serif" }}
                        >
                          <span className="text-[8px] sm:text-[10px] font-bold leading-none">
                            {style.label}
                          </span>
                        </div>
                      );
                    })()}

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

          {/* Animated piece overlay — slides from source to destination */}
          {animatingMove && boardPixelSize > 0 && (() => {
            const sqSize = boardPixelSize / 8;
            const pieceSize = sqSize * 0.85;
            const fromCenter = getSquareCenter(animatingMove.from);

            return (
              <div
                ref={animOverlayRef}
                style={{
                  position: "absolute",
                  width: pieceSize,
                  height: pieceSize,
                  left: 0,
                  top: 0,
                  transform: `translate(${fromCenter.x - pieceSize / 2}px, ${fromCenter.y - pieceSize / 2}px)`,
                  zIndex: 35,
                  pointerEvents: "none",
                }}
              >
                <Image
                  src={`/chess-icons/${animatingMove.piece.color}${animatingMove.piece.type}.png`}
                  alt="Moving piece"
                  width={100}
                  height={100}
                  className={cn(
                    "w-full h-full object-contain",
                    animatingMove.piece.color === "w"
                      ? "drop-shadow-[0_2px_3px_rgba(0,0,0,0.3)]"
                      : "drop-shadow-[0_2px_3px_rgba(0,0,0,0.5)]"
                  )}
                  draggable={false}
                />
              </div>
            );
          })()}

          {/* Drag ghost piece — follows pointer during drag */}
          {dragState && boardPixelSize > 0 && (() => {
            const sqSize = boardPixelSize / 8;
            const pieceSize = sqSize * 0.95;
            return (
              <div
                ref={dragGhostRef}
                style={{
                  position: "absolute",
                  width: pieceSize,
                  height: pieceSize,
                  left: 0,
                  top: 0,
                  transform: `translate(${dragState.x - pieceSize / 2}px, ${dragState.y - pieceSize / 2}px)`,
                  zIndex: 50,
                  pointerEvents: "none",
                }}
              >
                <Image
                  src={`/chess-icons/${dragState.piece.color}${dragState.piece.type}.png`}
                  alt="Dragging piece"
                  width={100}
                  height={100}
                  className={cn(
                    "w-full h-full object-contain",
                    dragState.piece.color === "w"
                      ? "drop-shadow-[0_4px_8px_rgba(0,0,0,0.4)]"
                      : "drop-shadow-[0_4px_8px_rgba(0,0,0,0.6)]"
                  )}
                  draggable={false}
                />
              </div>
            );
          })()}

          {/* SVG Arrow overlay — thick filled arrows with L-shape for knight moves */}
          {arrows.length > 0 && boardPixelSize > 0 && (
            <svg
              className="absolute inset-0 pointer-events-none z-30"
              width={boardPixelSize}
              height={boardPixelSize}
              viewBox={`0 0 ${boardPixelSize} ${boardPixelSize}`}
            >
              {arrows.map((arrow, i) => {
                const from = getSquareCenter(arrow.from);
                const to = getSquareCenter(arrow.to);
                const sqSize = boardPixelSize / 8;
                const colors = arrowColorMap[arrow.color] ?? arrowFill;

                // Dimensions — proportional for smaller squares
                const shaftW = sqSize * 0.15;   // shaft half-width
                const headW = sqSize * 0.32;    // arrowhead half-width
                const headL = sqSize * 0.35;    // arrowhead length

                // Detect knight move (L-shape): 2+1 or 1+2 squares
                const fileDiff = Math.abs(
                  arrow.to.charCodeAt(0) - arrow.from.charCodeAt(0)
                );
                const rankDiff = Math.abs(
                  parseInt(arrow.to[1]!) - parseInt(arrow.from[1]!)
                );
                const isKnight =
                  (fileDiff === 2 && rankDiff === 1) ||
                  (fileDiff === 1 && rankDiff === 2);

                if (isKnight) {
                  // L-shaped arrow: go along the longer axis first, then turn
                  // Corner: horizontal first if fileDiff=2, vertical first if rankDiff=2
                  const corner =
                    fileDiff === 2
                      ? { x: to.x, y: from.y } // horizontal then vertical
                      : { x: from.x, y: to.y }; // vertical then horizontal

                  // Last segment direction (corner → to)
                  const ldx = to.x - corner.x;
                  const ldy = to.y - corner.y;
                  const lLen = Math.sqrt(ldx * ldx + ldy * ldy);
                  const ld = { x: ldx / lLen, y: ldy / lLen };
                  const lp = { x: -ld.y, y: ld.x }; // perpendicular

                  // Tip and head base
                  const tip = to;
                  const hb = {
                    x: tip.x - ld.x * headL,
                    y: tip.y - ld.y * headL,
                  };

                  // Build shaft path as thick stroke with round join
                  const shaftPath = `M ${from.x} ${from.y} L ${corner.x} ${corner.y} L ${hb.x} ${hb.y}`;

                  // Arrowhead triangle
                  const headLeft = {
                    x: hb.x + lp.x * headW,
                    y: hb.y + lp.y * headW,
                  };
                  const headRight = {
                    x: hb.x - lp.x * headW,
                    y: hb.y - lp.y * headW,
                  };

                  return (
                    <g key={i}>
                      <path
                        d={shaftPath}
                        stroke={colors.shaft}
                        strokeWidth={shaftW * 2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        fill="none"
                      />
                      <polygon
                        points={`${tip.x},${tip.y} ${headLeft.x},${headLeft.y} ${headRight.x},${headRight.y}`}
                        fill={colors.head}
                      />
                      {/* Cover the shaft end so it doesn't poke past arrowhead base */}
                      <line
                        x1={headLeft.x}
                        y1={headLeft.y}
                        x2={headRight.x}
                        y2={headRight.y}
                        stroke={colors.head}
                        strokeWidth={2}
                      />
                    </g>
                  );
                }

                // Straight arrow
                const dx = to.x - from.x;
                const dy = to.y - from.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len === 0) return null;
                const d = { x: dx / len, y: dy / len };
                const p = { x: -d.y, y: d.x }; // perpendicular

                // Arrowhead base point
                const hb = {
                  x: to.x - d.x * headL,
                  y: to.y - d.y * headL,
                };

                // Build filled polygon: shaft rectangle + arrowhead triangle
                const points = [
                  // Shaft left side
                  { x: from.x + p.x * shaftW, y: from.y + p.y * shaftW },
                  // Shaft left to head base
                  { x: hb.x + p.x * shaftW, y: hb.y + p.y * shaftW },
                  // Head left wing
                  { x: hb.x + p.x * headW, y: hb.y + p.y * headW },
                  // Tip
                  { x: to.x, y: to.y },
                  // Head right wing
                  { x: hb.x - p.x * headW, y: hb.y - p.y * headW },
                  // Shaft right at head base
                  { x: hb.x - p.x * shaftW, y: hb.y - p.y * shaftW },
                  // Shaft right side
                  { x: from.x - p.x * shaftW, y: from.y - p.y * shaftW },
                ];

                const pathD = points
                  .map((pt, idx) =>
                    idx === 0 ? `M ${pt.x} ${pt.y}` : `L ${pt.x} ${pt.y}`
                  )
                  .join(" ") + " Z";

                return (
                  <path
                    key={i}
                    d={pathD}
                    fill={colors.shaft}
                  />
                );
              })}
            </svg>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChessBoard;
