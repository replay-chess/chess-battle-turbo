"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Chess, type Color, type Square } from "chess.js";
import { cn } from "@/lib/utils";

export interface MoveSequencePreviewProps {
  fen: string;
  moves: string[];
  children: ReactNode;
}

export interface PreparedMoveSequencePreview {
  positions: string[];
  lastMoves: Array<{ from: Square; to: Square } | null>;
}

interface PopupPosition {
  left: number;
  size: number;
  top: number;
}

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;
const MOVE_DELAY_MS = 1_400;
const LOOP_RESTART_DELAY_MS = 1_800;

function parseUciMove(uci: string) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
    throw new Error(`Invalid UCI move: ${uci}`);
  }

  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci[4] as "q" | "r" | "b" | "n" | undefined,
  };
}

/** Builds every frame once so an invalid FEN or illegal article line fails safely. */
export function prepareMoveSequencePreview(
  fen: string,
  moves: string[],
): PreparedMoveSequencePreview {
  const chess = new Chess(fen);
  const positions = [chess.fen()];
  const lastMoves: PreparedMoveSequencePreview["lastMoves"] = [null];

  for (const uci of moves) {
    const move = parseUciMove(uci);
    const playedMove = chess.move(move);
    positions.push(chess.fen());
    lastMoves.push({ from: playedMove.from, to: playedMove.to });
  }

  return { positions, lastMoves };
}

/** Returns the next frame; the final frame loops back to the pre-sequence FEN. */
export function nextMoveSequenceFrame(
  currentFrame: number,
  frameCount: number,
  shouldLoop = true,
): number {
  if (frameCount <= 1) return 0;
  if (currentFrame >= frameCount - 1) {
    return shouldLoop ? 0 : frameCount - 1;
  }
  return currentFrame + 1;
}

function displaySquares(orientation: Color): Square[] {
  const squares = RANKS.flatMap((rank) =>
    FILES.map((file) => `${file}${rank}` as Square),
  );
  return orientation === "b" ? squares.reverse() : squares;
}

function getPopupPosition(trigger: HTMLElement): PopupPosition {
  const rect = trigger.getBoundingClientRect();
  const gutter = 12;
  const gap = 10;
  const availableDimension = Math.min(
    window.innerWidth - gutter * 2,
    window.innerHeight - gutter * 2,
  );
  const size = Math.max(0, Math.min(240, availableDimension));
  const centeredLeft = rect.left + rect.width / 2 - size / 2;
  const left = Math.min(
    window.innerWidth - size - gutter,
    Math.max(gutter, centeredLeft),
  );
  const fitsAbove = rect.top >= size + gap + gutter;
  const preferredTop = fitsAbove ? rect.top - size - gap : rect.bottom + gap;
  const top = Math.min(
    window.innerHeight - size - gutter,
    Math.max(gutter, preferredTop),
  );

  return { left, size, top };
}

export function MoveSequencePreview({
  fen,
  moves,
  children,
}: MoveSequencePreviewProps) {
  const tooltipId = `move-preview-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [frame, setFrame] = useState(0);
  const [popupPosition, setPopupPosition] = useState<PopupPosition | null>(null);
  const movesKey = moves.join(" ");

  const prepared = useMemo(() => {
    try {
      return {
        value: prepareMoveSequencePreview(fen, moves),
        error: null,
      };
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : "Invalid move sequence",
      };
    }
    // movesKey gives MDX array literals a stable dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, movesKey]);

  const isOpen = Boolean(
    prepared.value && (isHovered || isFocused || isPinned),
  );

  const updatePopupPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (trigger) setPopupPosition(getPopupPosition(trigger));
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(media.matches);
    const handleChange = (event: MediaQueryListEvent) =>
      setPrefersReducedMotion(event.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setFrame(0);
      setPopupPosition(null);
      return;
    }

    updatePopupPosition();
    window.addEventListener("resize", updatePopupPosition);
    window.addEventListener("scroll", updatePopupPosition, true);
    return () => {
      window.removeEventListener("resize", updatePopupPosition);
      window.removeEventListener("scroll", updatePopupPosition, true);
    };
  }, [isOpen, updatePopupPosition]);

  useEffect(() => {
    if (!isOpen || prefersReducedMotion || !prepared.value) return;

    const isFinalFrame = frame === prepared.value.positions.length - 1;
    const shouldLoop = moves.length > 1;
    if (isFinalFrame && !shouldLoop) return;

    const timer = window.setTimeout(
      () =>
        setFrame((currentFrame) =>
          nextMoveSequenceFrame(
            currentFrame,
            prepared.value?.positions.length ?? 0,
            shouldLoop,
          ),
        ),
      isFinalFrame ? LOOP_RESTART_DELAY_MS : MOVE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [frame, isOpen, moves.length, prefersReducedMotion, prepared.value]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (triggerRef.current?.contains(event.target as Node)) return;
      setIsPinned(false);
      setIsFocused(false);
      setIsHovered(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  const closePreview = () => {
    setIsPinned(false);
    setIsFocused(false);
    setIsHovered(false);
    triggerRef.current?.blur();
  };

  if (prepared.error || !prepared.value) {
    return <span>{children}</span>;
  }

  const positionFen = prepared.value.positions[frame] ?? prepared.value.positions[0]!;
  const chess = new Chess(positionFen);
  const board = chess.board().flat();
  const orientation: Color = fen.split(" ")[1] === "b" ? "b" : "w";
  const squares = displaySquares(orientation);
  const lastMove = prepared.value.lastMoves[frame] ?? null;

  const popup =
    isOpen && popupPosition
      ? createPortal(
          <span
            id={tooltipId}
            role="tooltip"
            aria-label="Autoplaying chessboard preview"
            className="pointer-events-none fixed z-[100] block overflow-hidden border border-cb-border-strong bg-cb-surface p-1.5 shadow-[0_18px_55px_rgba(0,0,0,0.28)]"
            style={{
              left: popupPosition.left,
              top: popupPosition.top,
              width: popupPosition.size,
            }}
          >
            <span
              aria-hidden="true"
              className="grid aspect-square w-full grid-cols-8 overflow-hidden"
            >
              {squares.map((square) => {
                const file = square.charCodeAt(0) - 97;
                const rank = Number(square[1]) - 1;
                const piece = board[(7 - rank) * 8 + file] ?? null;
                const isLight = (file + rank) % 2 === 1;
                const isLastMove =
                  lastMove?.from === square || lastMove?.to === square;

                return (
                  <span
                    key={square}
                    className={cn(
                      "relative flex aspect-square items-center justify-center",
                      isLight
                        ? "bg-[var(--article-board-light)]"
                        : "bg-[var(--article-board-dark)]",
                    )}
                  >
                    {isLastMove && (
                      <span className="absolute inset-0 bg-[var(--article-board-last)]" />
                    )}
                    {piece && (
                      <Image
                        src={`/chess-icons/${piece.color}${piece.type}.png`}
                        alt=""
                        width={48}
                        height={48}
                        unoptimized
                        draggable={false}
                        className="relative z-10 h-[88%] w-[88%] select-none object-contain drop-shadow-[0_1px_1px_rgba(0,0,0,0.2)]"
                      />
                    )}
                  </span>
                );
              })}
            </span>
          </span>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-expanded={isOpen}
        className="inline cursor-help appearance-none border-0 border-b border-dotted border-cb-border-strong bg-transparent p-0 font-[inherit] text-inherit underline-offset-4 transition-colors hover:border-cb-text focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cb-accent focus-visible:ring-offset-2 focus-visible:ring-offset-cb-bg"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closePreview();
          }
        }}
        onPointerUp={(event) => {
          if (event.pointerType === "mouse") return;
          if (isPinned) closePreview();
          else setIsPinned(true);
        }}
      >
        {children}
      </button>
      {popup}
    </>
  );
}
