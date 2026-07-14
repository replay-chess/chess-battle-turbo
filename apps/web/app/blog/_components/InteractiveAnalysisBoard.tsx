"use client";

import Image from "next/image";
import {
  AlertCircle,
  LoaderCircle,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  Undo2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import type { MultiPvLine } from "@/lib/hooks/useStockfish";
import { cn } from "@/lib/utils";
import { useArticleStockfish } from "./ArticleStockfishProvider";

export interface InteractiveAnalysisBoardProps {
  fen: string;
  moves: string[];
  title?: string;
  orientation?: "auto" | "white" | "black";
  moveIntervalMs?: number;
  loopDelayMs?: number;
}

interface PreparedDemo {
  positions: string[];
  lastMoves: Array<{ from: Square; to: Square } | null>;
}

interface PositionSnapshot {
  fen: string;
  lastMove: { from: Square; to: Square } | null;
}

interface PendingPromotion {
  from: Square;
  to: Square;
  color: Color;
}

export interface ArticleMoveCell {
  san: string;
  plyIndex: number;
}

export interface ArticleMoveRow {
  moveNumber: number;
  white?: ArticleMoveCell;
  black?: ArticleMoveCell;
}

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;
const LINE_COLORS = ["#5f8f72", "#6f84a8", "#b28652", "#8d709d", "#a8605a"];
const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

function uciParts(uci: string) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
    throw new Error(`Invalid UCI move: ${uci}`);
  }
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci[4] as "q" | "r" | "b" | "n" | undefined,
  };
}

export function prepareInteractiveDemo(
  fen: string,
  moves: string[],
): PreparedDemo {
  const chess = new Chess(fen);
  const positions = [chess.fen()];
  const lastMoves: PreparedDemo["lastMoves"] = [null];
  for (const uci of moves) {
    const move = uciParts(uci);
    chess.move(move);
    positions.push(chess.fen());
    lastMoves.push({ from: move.from, to: move.to });
  }
  return { positions, lastMoves };
}

export function articleBoardOrientation(
  orientation: InteractiveAnalysisBoardProps["orientation"],
  fen: string,
): Color {
  if (orientation === "white") return "w";
  if (orientation === "black") return "b";
  return fen.split(" ")[1] === "b" ? "b" : "w";
}

function displaySquares(orientation: Color): Square[] {
  const squares = RANKS.flatMap((rank) =>
    FILES.map((file) => `${file}${rank}` as Square),
  );
  return orientation === "b" ? squares.reverse() : squares;
}

function squareCenter(square: Square, orientation: Color) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const col = orientation === "w" ? file : 7 - file;
  const row = orientation === "w" ? 7 - rank : rank;
  return { x: col * 100 + 50, y: row * 100 + 50 };
}

function pointToSquare(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  orientation: Color,
): Square | null {
  const col = Math.floor(((clientX - rect.left) / rect.width) * 8);
  const row = Math.floor(((clientY - rect.top) / rect.height) * 8);
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  const fileIndex = orientation === "w" ? col : 7 - col;
  const rank = orientation === "w" ? 8 - row : row + 1;
  return `${FILES[fileIndex]}${rank}` as Square;
}

export function articlePvToSan(
  fen: string,
  pv: string[],
  maxPlies = 6,
): string {
  const chess = new Chess(fen);
  const san: string[] = [];
  for (const uci of pv.slice(0, maxPlies)) {
    try {
      const result = chess.move(uciParts(uci));
      san.push(result.san);
    } catch {
      break;
    }
  }
  return san.join(" ");
}

function firstMoveSan(fen: string, pv: string[]): string {
  if (!pv[0]) return "—";
  try {
    return new Chess(fen).move(uciParts(pv[0])).san;
  } catch {
    return pv[0];
  }
}

/** Groups a UCI line into conventional full-move rows from the supplied FEN. */
export function articleMoveRows(
  fen: string,
  moves: string[],
): ArticleMoveRow[] {
  const chess = new Chess(fen);
  const rows: ArticleMoveRow[] = [];

  moves.forEach((uci, index) => {
    const side = chess.turn();
    const moveNumber = Number.parseInt(chess.fen().split(" ")[5] ?? "1", 10);
    const played = chess.move(uciParts(uci));
    let row = rows.at(-1);

    if (!row || row.moveNumber !== moveNumber) {
      row = { moveNumber };
      rows.push(row);
    }

    row[side === "w" ? "white" : "black"] = {
      san: played.san,
      plyIndex: index + 1,
    };
  });

  return rows;
}

export function formatArticleEngineScore(
  line: MultiPvLine,
  fen: string,
): string {
  const multiplier = fen.split(" ")[1] === "b" ? -1 : 1;
  if (line.scoreMate !== null) {
    const mate = line.scoreMate * multiplier;
    return mate > 0 ? `+M${mate}` : `−M${Math.abs(mate)}`;
  }
  if (line.scoreCp !== null) {
    const score = (line.scoreCp * multiplier) / 100;
    if (score > 0) return `+${score.toFixed(2)}`;
    if (score < 0) return `−${Math.abs(score).toFixed(2)}`;
    return "0.00";
  }
  return "—";
}

function boardLabel(
  square: Square,
  piece?: { color: Color; type: PieceSymbol },
) {
  if (!piece) return `${square}, empty`;
  return `${square}, ${piece.color === "w" ? "white" : "black"} ${PIECE_NAMES[piece.type]}`;
}

export function InteractiveAnalysisBoard({
  fen,
  moves,
  title = "Interactive chess analysis",
  orientation = "auto",
  moveIntervalMs = 900,
  loopDelayMs = 1500,
}: InteractiveAnalysisBoardProps) {
  const rawId = useId();
  const boardId = `article-board-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const rootRef = useRef<HTMLElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    square: Square;
    x: number;
    y: number;
    pointerId: number;
  } | null>(null);
  const lineMapRef = useRef<Map<number, MultiPvLine>>(new Map());
  const firstIncomingLineRef = useRef(true);
  const [isVisible, setIsVisible] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [demoIndex, setDemoIndex] = useState(0);
  const [positionFen, setPositionFen] = useState(fen);
  const [lastMove, setLastMove] = useState<PositionSnapshot["lastMove"]>(null);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [history, setHistory] = useState<PositionSnapshot[]>([]);
  const [hasExplored, setHasExplored] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [pendingPromotion, setPendingPromotion] =
    useState<PendingPromotion | null>(null);
  const [engineLines, setEngineLines] = useState<MultiPvLine[]>([]);
  const [engineLinesFen, setEngineLinesFen] = useState<string | null>(null);
  const [currentDepth, setCurrentDepth] = useState(0);
  const stockfish = useArticleStockfish();
  const analyzePosition = stockfish.analyze;
  const cancelAnalysis = stockfish.cancel;

  const prepared = useMemo(() => {
    try {
      return { demo: prepareInteractiveDemo(fen, moves), error: null };
    } catch (error) {
      return {
        demo: null,
        error: error instanceof Error ? error.message : "Invalid position",
      };
    }
  }, [fen, moves]);
  const moveRows = useMemo(() => articleMoveRows(fen, moves), [fen, moves]);

  const baseOrientation = articleBoardOrientation(orientation, fen);
  const viewedFrom: Color = isFlipped
    ? baseOrientation === "w"
      ? "b"
      : "w"
    : baseOrientation;
  const squares = useMemo(() => displaySquares(viewedFrom), [viewedFrom]);
  const game = useMemo(() => {
    try {
      return new Chess(positionFen);
    } catch {
      return null;
    }
  }, [positionFen]);
  const legalTargets = useMemo(() => {
    if (!game || !selectedSquare || isPlaying) return [];
    return game
      .moves({ square: selectedSquare, verbose: true })
      .map((move) => move.to as Square);
  }, [game, isPlaying, selectedSquare]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry?.isIntersecting ?? false),
      { threshold: 0.15 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) setIsPlaying(false);
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) setIsPlaying(false);
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (!prepared.demo) return;
    setPositionFen(prepared.demo.positions[0]!);
    setLastMove(null);
    setDemoIndex(0);
    setHistory([]);
    setHasExplored(false);
    setSelectedSquare(null);
  }, [prepared.demo]);

  useEffect(() => {
    if (!prepared.demo || !isPlaying || !isVisible) return;
    const atEnd = demoIndex >= prepared.demo.positions.length - 1;
    const timer = window.setTimeout(
      () => {
        const nextIndex = atEnd ? 0 : demoIndex + 1;
        setDemoIndex(nextIndex);
        setPositionFen(prepared.demo!.positions[nextIndex]!);
        setLastMove(prepared.demo!.lastMoves[nextIndex]!);
        setSelectedSquare(null);
      },
      atEnd ? loopDelayMs : moveIntervalMs,
    );
    return () => window.clearTimeout(timer);
  }, [
    demoIndex,
    isPlaying,
    isVisible,
    loopDelayMs,
    moveIntervalMs,
    prepared.demo,
  ]);

  const requestAnalysis = useCallback(
    (targetFen: string, count: number) => {
      firstIncomingLineRef.current = true;
      lineMapRef.current = new Map();
      analyzePosition({
        boardId,
        fen: targetFen,
        count,
        depth: 16,
        onLine(line) {
          if (firstIncomingLineRef.current) {
            firstIncomingLineRef.current = false;
            lineMapRef.current.clear();
            setEngineLinesFen(targetFen);
          }
          lineMapRef.current.set(line.multipv, line);
          setEngineLines(
            [...lineMapRef.current.values()].sort(
              (left, right) => left.multipv - right.multipv,
            ),
          );
          setCurrentDepth((depth) => Math.max(depth, line.depth));
        },
      });
    },
    [analyzePosition, boardId],
  );

  useEffect(() => {
    if (isPlaying || !prepared.demo) return;
    requestAnalysis(positionFen, hasExplored ? 5 : 3);
  }, [hasExplored, isPlaying, positionFen, prepared.demo, requestAnalysis]);

  useEffect(
    () => () => {
      cancelAnalysis(boardId);
    },
    [boardId, cancelAnalysis],
  );

  const applyMove = useCallback(
    (from: Square, to: Square, promotion?: "q" | "r" | "b" | "n") => {
      if (isPlaying) return;
      try {
        const chess = new Chess(positionFen);
        const move = chess.move({ from, to, promotion });
        setHistory((snapshots) => [
          ...snapshots,
          { fen: positionFen, lastMove },
        ]);
        setPositionFen(chess.fen());
        setLastMove({ from: move.from, to: move.to });
        setSelectedSquare(null);
        setPendingPromotion(null);
        setHasExplored(true);
      } catch {
        setSelectedSquare(null);
      }
    },
    [isPlaying, lastMove, positionFen],
  );

  const attemptMove = useCallback(
    (from: Square, to: Square) => {
      if (!game || isPlaying) return;
      const candidates = game.moves({ square: from, verbose: true });
      const promotionMoves = candidates.filter(
        (move) => move.to === to && Boolean(move.promotion),
      );
      if (promotionMoves.length > 0) {
        setPendingPromotion({ from, to, color: game.turn() });
        return;
      }
      if (candidates.some((move) => move.to === to)) applyMove(from, to);
      else setSelectedSquare(null);
    },
    [applyMove, game, isPlaying],
  );

  const handleSquareClick = useCallback(
    (square: Square) => {
      if (!game || isPlaying) return;
      if (selectedSquare) {
        if (selectedSquare === square) {
          setSelectedSquare(null);
          return;
        }
        if (legalTargets.includes(square)) {
          attemptMove(selectedSquare, square);
          return;
        }
      }
      const piece = game.get(square);
      setSelectedSquare(piece?.color === game.turn() ? square : null);
    },
    [attemptMove, game, isPlaying, legalTargets, selectedSquare],
  );

  const handlePiecePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    square: Square,
  ) => {
    if (isPlaying || event.button !== 0) return;
    event.preventDefault();
    dragRef.current = {
      square,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    boardRef.current?.setPointerCapture(event.pointerId);
    setSelectedSquare(square);
  };

  const handleBoardPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const target = pointToSquare(
      event.clientX,
      event.clientY,
      rect,
      viewedFrom,
    );
    const distance = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
    if (target && (target !== drag.square || distance >= 4)) {
      attemptMove(drag.square, target);
    }
  };

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      setHistory([]);
      setHasExplored(false);
      return;
    }
    cancelAnalysis(boardId);
    lineMapRef.current.clear();
    setEngineLines([]);
    setEngineLinesFen(null);
    setCurrentDepth(0);
    setDemoIndex(0);
    setPositionFen(prepared.demo?.positions[0] ?? fen);
    setLastMove(null);
    setHistory([]);
    setHasExplored(false);
    setSelectedSquare(null);
    setIsPlaying(true);
  };

  const reset = () => {
    cancelAnalysis(boardId);
    setIsPlaying(false);
    setDemoIndex(0);
    setPositionFen(prepared.demo?.positions[0] ?? fen);
    setLastMove(null);
    setHistory([]);
    setHasExplored(false);
    setSelectedSquare(null);
    setPendingPromotion(null);
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((snapshots) => snapshots.slice(0, -1));
    setPositionFen(previous.fen);
    setLastMove(previous.lastMove);
    setSelectedSquare(null);
    setPendingPromotion(null);
  };

  const playEngineMove = (line: MultiPvLine) => {
    const uci = line.pv[0];
    if (!uci) return;
    const move = uciParts(uci);
    applyMove(move.from, move.to, move.promotion);
  };

  if (prepared.error || !prepared.demo || !game) {
    return (
      <aside className="my-10 border border-cb-border bg-cb-surface p-6 text-cb-text-secondary">
        <p className="font-sans text-sm font-medium text-cb-text">
          Position unavailable
        </p>
        <p className="mt-2 font-sans text-sm">
          This interactive chess position could not be loaded.
        </p>
      </aside>
    );
  }

  const board = game.board().flat();
  const arrowsVisible = !isPlaying && engineLinesFen === positionFen;
  const isActiveEngine = stockfish.activeBoardId === boardId;

  return (
    <section
      ref={rootRef}
      aria-label={title}
      className="relative left-1/2 my-12 w-[min(calc(100vw-2rem),50rem)] -translate-x-1/2 border border-cb-border bg-cb-surface"
    >
      <header className="border-b border-cb-border px-4 py-4 sm:px-5">
        <div>
          <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-cb-text-muted">
            Interactive analysis
          </p>
          <h3 className="mt-1 font-serif text-xl text-cb-text sm:text-2xl">
            {title}
          </h3>
        </div>
      </header>

      <div className="grid gap-0 md:h-[30.5rem] md:grid-cols-[minmax(0,1fr)_minmax(17rem,0.68fr)]">
        <div className="p-3 sm:p-5">
          <div
            ref={boardRef}
            role="grid"
            aria-label={`Chessboard viewed from the ${viewedFrom === "w" ? "white" : "black"} side`}
            className="relative mx-auto grid aspect-square w-full max-w-[28rem] touch-none grid-cols-8 overflow-hidden border border-cb-border-strong shadow-[0_18px_55px_rgba(0,0,0,0.12)]"
            onPointerUp={handleBoardPointerUp}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
          >
            {squares.map((square, index) => {
              const file = square.charCodeAt(0) - 97;
              const rank = Number(square[1]) - 1;
              const piece = board[(7 - rank) * 8 + file] ?? null;
              const isLight = (file + rank) % 2 === 1;
              const isSelected = selectedSquare === square;
              const isLegal = legalTargets.includes(square);
              const isLast =
                lastMove?.from === square || lastMove?.to === square;
              const displayCol = index % 8;
              const displayRow = Math.floor(index / 8);
              return (
                <button
                  key={square}
                  type="button"
                  role="gridcell"
                  aria-label={boardLabel(square, piece ?? undefined)}
                  onClick={() => handleSquareClick(square)}
                  onPointerDown={(event) => {
                    if (piece?.color === game.turn()) {
                      handlePiecePointerDown(event, square);
                    }
                  }}
                  className={cn(
                    "relative flex aspect-square items-center justify-center outline-none focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-cb-accent focus-visible:ring-inset",
                    isLight
                      ? "bg-[var(--article-board-light)]"
                      : "bg-[var(--article-board-dark)]",
                  )}
                >
                  {isLast && (
                    <span className="absolute inset-0 bg-[var(--article-board-last)]" />
                  )}
                  {isSelected && (
                    <span className="absolute inset-0 bg-[var(--article-board-selected)]" />
                  )}
                  {isLegal && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "pointer-events-none absolute z-10 rounded-full",
                        piece
                          ? "inset-[7%] border-[5px] border-[rgba(18,18,18,0.68)] bg-transparent shadow-[inset_0_0_0_2px_rgba(255,255,255,0.58)]"
                          : "h-[22%] w-[22%] border-2 border-white/85 bg-black/65 shadow-[0_1px_5px_rgba(0,0,0,0.55)]",
                      )}
                    />
                  )}
                  {piece && (
                    <Image
                      src={`/chess-icons/${piece.color}${piece.type}.png`}
                      alt=""
                      width={96}
                      height={96}
                      unoptimized
                      draggable={false}
                      className="pointer-events-none relative z-10 h-[86%] w-[86%] select-none object-contain drop-shadow-[0_3px_2px_rgba(0,0,0,0.22)]"
                    />
                  )}
                  {displayCol === 0 && (
                    <span className="pointer-events-none absolute left-1 top-0.5 z-10 font-sans text-[9px] font-semibold text-black/45 mix-blend-multiply sm:text-[10px]">
                      {square[1]}
                    </span>
                  )}
                  {displayRow === 7 && (
                    <span className="pointer-events-none absolute bottom-0 right-1 z-10 font-sans text-[9px] font-semibold text-black/45 mix-blend-multiply sm:text-[10px]">
                      {square[0]}
                    </span>
                  )}
                </button>
              );
            })}

            {arrowsVisible && engineLines.length > 0 && (
              <svg
                className="pointer-events-none absolute inset-0 z-20 h-full w-full"
                viewBox="0 0 800 800"
                aria-hidden="true"
              >
                <defs>
                  {engineLines.map((line, index) => (
                    <marker
                      key={`marker-${line.multipv}`}
                      id={`${boardId}-arrow-${line.multipv}`}
                      markerWidth="5"
                      markerHeight="5"
                      refX="3.7"
                      refY="2.5"
                      orient="auto"
                    >
                      <path
                        d="M0,0 L5,2.5 L0,5 Z"
                        fill={LINE_COLORS[index] ?? LINE_COLORS[0]}
                        fillOpacity="0.82"
                      />
                    </marker>
                  ))}
                </defs>
                {engineLines.map((line, index) => {
                  const uci = line.pv[0];
                  if (!uci) return null;
                  const { from, to } = uciParts(uci);
                  const start = squareCenter(from, viewedFrom);
                  const end = squareCenter(to, viewedFrom);
                  const dx = end.x - start.x;
                  const dy = end.y - start.y;
                  const length = Math.hypot(dx, dy) || 1;
                  const inset = 30;
                  return (
                    <line
                      key={`${line.multipv}-${uci}`}
                      x1={start.x + (dx / length) * inset}
                      y1={start.y + (dy / length) * inset}
                      x2={end.x - (dx / length) * inset}
                      y2={end.y - (dy / length) * inset}
                      stroke={LINE_COLORS[index] ?? LINE_COLORS[0]}
                      strokeWidth="14"
                      strokeLinecap="round"
                      strokeOpacity="0.7"
                      markerEnd={`url(#${boardId}-arrow-${line.multipv})`}
                    />
                  );
                })}
              </svg>
            )}

            {pendingPromotion && (
              <div
                className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
                role="dialog"
                aria-modal="true"
                aria-label="Choose promotion piece"
              >
                <div className="grid grid-cols-4 border border-cb-border-strong bg-cb-surface shadow-2xl">
                  {(["q", "r", "b", "n"] as const).map((piece) => (
                    <button
                      key={piece}
                      type="button"
                      onClick={() =>
                        applyMove(
                          pendingPromotion.from,
                          pendingPromotion.to,
                          piece,
                        )
                      }
                      className="flex h-16 w-16 items-center justify-center border-r border-cb-border bg-cb-surface hover:bg-cb-hover last:border-r-0"
                      aria-label={`Promote to ${PIECE_NAMES[piece]}`}
                    >
                      <Image
                        src={`/chess-icons/${pendingPromotion.color}${piece}.png`}
                        alt=""
                        width={56}
                        height={56}
                        unoptimized
                        className="h-12 w-12 object-contain"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="flex min-h-64 min-w-0 flex-col overflow-hidden border-t border-cb-border bg-cb-bg/50 md:min-h-0 md:border-l md:border-t-0">
          <div className="flex items-center justify-between gap-3 border-b border-cb-border px-4 py-3.5">
            <div>
              <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-cb-text-muted">
                {isPlaying ? "Authored continuation" : "Stockfish 18"}
              </p>
              <p className="mt-0.5 font-sans text-xs text-cb-text-secondary">
                {isPlaying
                  ? `${moveRows.length} full ${moveRows.length === 1 ? "move" : "moves"} · autoplay`
                  : hasExplored
                    ? "Top five replies"
                    : "Top three moves"}
              </p>
            </div>
            {!isPlaying && currentDepth > 0 && (
              <span className="font-mono text-[10px] text-cb-text-muted">
                d{currentDepth}
              </span>
            )}
          </div>

          {isPlaying ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <ol
                className="min-h-0 flex-1 overflow-y-auto font-sans text-sm text-cb-text-secondary"
                aria-label="Authored continuation"
              >
                {moveRows.map((row) => (
                  <li
                    key={row.moveNumber}
                    className="grid min-h-11 grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)] items-stretch border-b border-cb-border/70 even:bg-cb-hover/40"
                  >
                    <span className="flex items-center px-3 font-mono text-xs font-semibold text-cb-text-muted">
                      {row.moveNumber}.
                    </span>
                    {(["white", "black"] as const).map((side) => {
                      const move = row[side];
                      const isCurrent = move?.plyIndex === demoIndex;
                      return (
                        <span
                          key={side}
                          aria-current={isCurrent ? "step" : undefined}
                          className={cn(
                            "flex min-w-0 items-center px-3 font-mono text-sm font-semibold text-cb-text",
                            isCurrent &&
                              "bg-cb-accent text-cb-accent-fg shadow-[inset_0_-2px_0_rgba(0,0,0,0.12)]",
                          )}
                        >
                          {move?.san ?? ""}
                        </span>
                      );
                    })}
                  </li>
                ))}
              </ol>
              <p className="border-t border-cb-border px-4 py-3 font-sans text-[11px] leading-5 text-cb-text-muted">
                Pause at any point to explore legal alternatives with Stockfish.
              </p>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {stockfish.error && isActiveEngine ? (
                <div className="flex flex-col items-start justify-center py-8">
                  <AlertCircle size={20} className="text-red-500" />
                  <p className="mt-3 font-sans text-sm text-cb-text">
                    The engine could not load.
                  </p>
                  <button
                    type="button"
                    onClick={stockfish.retry}
                    className="mt-3 border border-cb-border-strong px-3 py-2 font-sans text-xs text-cb-text-secondary hover:text-cb-text"
                  >
                    Retry engine
                  </button>
                </div>
              ) : game.isGameOver() ? (
                <p className="py-8 font-sans text-sm text-cb-text-secondary">
                  This is a terminal position. Reset or undo to continue
                  analyzing.
                </p>
              ) : engineLines.length === 0 && isActiveEngine ? (
                <div className="flex items-center gap-2 py-8 font-sans text-sm text-cb-text-muted">
                  <LoaderCircle size={16} className="animate-spin" />
                  {stockfish.isReady
                    ? "Analyzing position…"
                    : "Loading engine…"}
                </div>
              ) : (
                <ol className="space-y-2" aria-label="Stockfish suggestions">
                  {engineLines.map((line, index) => (
                    <li key={line.multipv}>
                      <button
                        type="button"
                        onClick={() => playEngineMove(line)}
                        className="group grid w-full grid-cols-[0.65rem_3.4rem_minmax(0,1fr)] items-start gap-2 border border-cb-border bg-cb-surface px-3 py-2.5 text-left transition-colors hover:border-cb-border-strong hover:bg-cb-hover"
                      >
                        <span
                          className="mt-1.5 h-2 w-2 rounded-full"
                          style={{
                            backgroundColor:
                              LINE_COLORS[index] ?? LINE_COLORS[0],
                          }}
                        />
                        <span className="font-mono text-xs font-semibold text-cb-text">
                          {formatArticleEngineScore(line, positionFen)}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-mono text-sm font-semibold text-cb-text">
                            {firstMoveSan(positionFen, line.pv)}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[11px] text-cb-text-muted">
                            {articlePvToSan(positionFen, line.pv)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}

              {engineLinesFen !== positionFen && engineLines.length > 0 && (
                <p
                  className="mt-3 flex items-center gap-2 font-sans text-[11px] text-cb-text-muted"
                  aria-live="polite"
                >
                  <LoaderCircle size={12} className="animate-spin" /> Updating
                  lines…
                </p>
              )}
            </div>
          )}
        </aside>
      </div>

      <footer className="flex min-h-14 items-center justify-between gap-3 border-t border-cb-border bg-cb-bg/70 px-3 py-2 sm:px-4">
        <p className="hidden font-sans text-[11px] text-cb-text-muted sm:block">
          {isPlaying
            ? "Following the authored line"
            : hasExplored
              ? "Exploring your variation"
              : "Paused for analysis"}
        </p>
        <div
          className="ml-auto flex items-center gap-1"
          aria-label="Board controls"
        >
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 w-10 items-center justify-center border border-transparent text-cb-text-secondary transition-colors hover:border-cb-border hover:bg-cb-hover hover:text-cb-text"
            aria-label="Reset position"
            title="Reset position"
          >
            <RotateCcw size={17} />
          </button>
          <button
            type="button"
            onClick={undo}
            disabled={history.length === 0}
            className="inline-flex h-10 w-10 items-center justify-center border border-transparent text-cb-text-secondary transition-colors hover:border-cb-border hover:bg-cb-hover hover:text-cb-text disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Undo explored move"
            title="Undo explored move"
          >
            <Undo2 size={17} />
          </button>
          <button
            type="button"
            onClick={() => setIsFlipped((value) => !value)}
            className="inline-flex h-10 w-10 items-center justify-center border border-transparent text-cb-text-secondary transition-colors hover:border-cb-border hover:bg-cb-hover hover:text-cb-text"
            aria-label="Flip board"
            title="Flip board"
          >
            <Repeat2 size={18} />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            className="ml-1 inline-flex h-10 min-w-24 items-center justify-center gap-2 border border-cb-border-strong bg-cb-accent px-3 font-sans text-xs font-medium text-cb-accent-fg transition-opacity hover:opacity-85"
            aria-label={
              isPlaying ? "Pause demonstration" : "Play demonstration"
            }
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            {isPlaying ? "Pause" : "Play"}
          </button>
        </div>
      </footer>
    </section>
  );
}
