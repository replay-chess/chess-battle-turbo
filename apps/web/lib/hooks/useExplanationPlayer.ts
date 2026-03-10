"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Chess, Square, PieceSymbol, Color } from "chess.js";

// ===== Types =====

interface ExplanationVisual {
  type: "highlight" | "arrow" | "showMove" | "clearVisuals" | "resetBoard"
    | "undoMoves" | "annotateSquare" | "annotate" | "showEvalBar";
  squares?: string[];
  color?: string;
  from?: string;
  to?: string;
  san?: string;
  count?: number;
  square?: string;
  symbol?: string;
  icon?: string;
  score?: number;
  description?: string;
  triggerTime?: number;
}

interface ExplanationSegment {
  visuals: ExplanationVisual[];
  narration: string;
  startTime: number;
  endTime: number;
}

interface ExplanationAlignment {
  words: string[];
  startTimes: number[];
  endTimes: number[];
}

export interface ExplanationData {
  fen: string;
  segments: ExplanationSegment[];
  audioFile?: string;
  alignment?: ExplanationAlignment;
  generatedAt?: string;
}

export interface HighlightGroup {
  squares: Square[];
  color: string;
}

export interface ArrowData {
  from: Square;
  to: Square;
  color: string;
}

export interface SquareAnnotation {
  square: Square;
  symbol: string; // "!!", "!", "best", "excellent", "good", "book", "?!", "?", "??", "miss"
  icon?: string;  // e.g. "brilliant_128x.png" — rendered from /board_icons/128x/
  color?: string; // hex color for icon-based annotations
}

export interface EvalBarData {
  score: number;       // centipawns, positive = White advantage
  description: string; // human-readable
}

type PieceInfo = {
  square: Square;
  type: "p" | "n" | "b" | "r" | "q" | "k";
  color: "w" | "b";
} | null;

// ===== Hook =====

export function useExplanationPlayer(
  explanation: ExplanationData | null,
  audioUrl: string | null
) {
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [activeHighlights, setActiveHighlights] = useState<HighlightGroup[]>([]);
  const [activeArrows, setActiveArrows] = useState<ArrowData[]>([]);
  const [activeAnnotations, setActiveAnnotations] = useState<SquareAnnotation[]>([]);
  const [evalBar, setEvalBar] = useState<EvalBarData | null>(null);
  const [board, setBoard] = useState<PieceInfo[][]>([]);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);

  const [animatingMove, setAnimatingMove] = useState<{
    piece: { type: PieceSymbol; color: Color };
    from: Square;
    to: Square;
  } | null>(null);

  const chessRef = useRef<Chess | null>(null);
  const moveHistoryRef = useRef<string[]>([]); // FENs for undo support
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);
  const currentTimeRef = useRef(0);
  const triggeredVisualsRef = useRef<Set<string>>(new Set());
  const animTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processedSegmentRef = useRef<number>(-1);

  const originalFen = explanation?.fen || "";
  const segments = explanation?.segments || [];
  const totalSegments = segments.length;
  const hasAudio = !!audioUrl;
  const isManualMode = !hasAudio;

  // Initialize chess instance and board
  useEffect(() => {
    if (!originalFen) {
      setBoard([]);
      return;
    }
    const chess = new Chess(originalFen);
    chessRef.current = chess;
    moveHistoryRef.current = [originalFen];
    setBoard(chess.board());
    setActiveHighlights([]);
    setActiveArrows([]);
    setActiveAnnotations([]);
    setEvalBar(null);
    setLastMove(null);
    setCurrentSegmentIndex(0);
    processedSegmentRef.current = -1;
  }, [originalFen]);

  // Initialize audio element
  useEffect(() => {
    if (!audioUrl) {
      audioRef.current = null;
      return;
    }
    const audio = new Audio(audioUrl);
    audio.preload = "auto";
    audioRef.current = audio;

    const handleLoadedMetadata = () => setDuration(audio.duration);
    const handleEnded = () => {
      setIsPlaying(false);
      cancelAnimationFrame(rafRef.current);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audio.pause();
      audio.src = "";
    };
  }, [audioUrl]);

  // Helper: process a single visual command (shared between animated + instant replay)
  const applyVisual = useCallback(
    (visual: ExplanationVisual, animated: boolean): void => {
      switch (visual.type) {
        case "clearVisuals":
          setActiveHighlights([]);
          setActiveArrows([]);
          setActiveAnnotations([]);
          setLastMove(null);
          break;

        case "resetBoard": {
          const chess = new Chess(originalFen);
          chessRef.current = chess;
          moveHistoryRef.current = [originalFen];
          setBoard(chess.board());
          setLastMove(null);
          setActiveAnnotations([]);
          setEvalBar(null);
          break;
        }

        case "highlight":
          if (visual.squares) {
            setActiveHighlights((prev) => [
              ...prev,
              { squares: visual.squares as Square[], color: visual.color || "yellow" },
            ]);
          }
          break;

        case "arrow":
          if (visual.from && visual.to) {
            setActiveArrows((prev) => [
              ...prev,
              {
                from: visual.from as Square,
                to: visual.to as Square,
                color: visual.color || "yellow",
              },
            ]);
          }
          break;

        case "showMove": {
          if (visual.san && chessRef.current) {
            const san = visual.san;
            try {
              // Try SAN first (e.g. "Nxh6+"), fall back to UCI (e.g. "g2h3")
              let move;
              try {
                move = chessRef.current.move(san);
              } catch {
                const from = san.slice(0, 2) as Square;
                const to = san.slice(2, 4) as Square;
                const promotion = san.length > 4 ? san[4] : undefined;
                move = chessRef.current.move({ from, to, promotion: promotion as "q" | "r" | "b" | "n" | undefined });
              }
              if (move) {
                moveHistoryRef.current.push(chessRef.current.fen());
                setBoard(chessRef.current.board());
                setLastMove({ from: move.from as Square, to: move.to as Square });
                if (animated) {
                  setAnimatingMove({
                    piece: { type: move.piece as PieceSymbol, color: move.color as Color },
                    from: move.from as Square,
                    to: move.to as Square,
                  });
                }
              }
            } catch {
              // Invalid move — skip
            }
          }
          break;
        }

        case "undoMoves": {
          if (chessRef.current) {
            const count = visual.count || 1;
            for (let i = 0; i < count; i++) {
              chessRef.current.undo();
              if (moveHistoryRef.current.length > 1) {
                moveHistoryRef.current.pop();
              }
            }
            setBoard(chessRef.current.board());
            setLastMove(null);
            setActiveAnnotations([]);
          }
          break;
        }

        case "annotate":
        case "annotateSquare":
          if (visual.square && visual.symbol) {
            setActiveAnnotations((prev) => [
              ...prev,
              { square: visual.square as Square, symbol: visual.symbol!, icon: visual.icon, color: visual.color },
            ]);
          }
          break;

        case "showEvalBar":
          if (visual.score !== undefined) {
            setEvalBar({
              score: visual.score,
              description: visual.description || "",
            });
          }
          break;
      }
    },
    [originalFen]
  );

  // Reset board and visuals to beginning state for a target segment
  const resetToSegment = useCallback(
    (targetIndex: number) => {
      if (!originalFen || segments.length === 0) return;

      const chess = new Chess(originalFen);
      chessRef.current = chess;
      moveHistoryRef.current = [originalFen];
      setActiveHighlights([]);
      setActiveArrows([]);
      setActiveAnnotations([]);
      setEvalBar(null);
      setLastMove(null);
      setAnimatingMove(null);
      triggeredVisualsRef.current.clear();

      // Replay all visuals from segment 0 to targetIndex-1 instantly
      for (let i = 0; i < targetIndex; i++) {
        const seg = segments[i];
        if (!seg) continue;
        for (const visual of seg.visuals) {
          applyVisual(visual, false);
        }
      }

      // For the target segment, apply visuals that should have already triggered
      const targetSegment = segments[targetIndex];
      if (targetSegment) {
        const seekTime = targetSegment.startTime;
        targetSegment.visuals.forEach((visual, i) => {
          const key = `${targetIndex}:${i}`;
          const shouldApply = isManualMode
            || (visual.triggerTime !== undefined && visual.triggerTime <= seekTime)
            || (visual.triggerTime === undefined);
          if (shouldApply) {
            triggeredVisualsRef.current.add(key);
            applyVisual(visual, false);
          }
        });
      }

      setBoard(chessRef.current!.board());
      setCurrentSegmentIndex(targetIndex);
      processedSegmentRef.current = targetIndex;
    },
    [originalFen, segments, applyVisual, isManualMode]
  );

  // rAF loop for audio time sync — triggers visuals at their exact triggerTime
  useEffect(() => {
    if (!isPlaying || !audioRef.current) return;

    const tick = () => {
      const audio = audioRef.current;
      if (!audio) return;

      const t = audio.currentTime;
      currentTimeRef.current = t;

      // Find current segment
      const segIdx = segments.findIndex(
        (s) => t >= s.startTime && t < s.endTime
      );

      if (segIdx !== -1) {
        // Segment changed — reset visual tracking
        if (segIdx !== processedSegmentRef.current) {
          triggeredVisualsRef.current.clear();
          setCurrentSegmentIndex(segIdx);
          processedSegmentRef.current = segIdx;
          setAnimatingMove(null);
          if (animTimeoutRef.current) clearTimeout(animTimeoutRef.current);
        }

        // Collect newly triggered visuals for this frame
        const segment = segments[segIdx];
        if (segment) {
          const newTriggers: ExplanationVisual[] = [];
          segment.visuals.forEach((visual, i) => {
            const key = `${segIdx}:${i}`;
            if (triggeredVisualsRef.current.has(key)) return;
            const trigger = visual.triggerTime;
            // Fire if triggerTime reached, or immediately if no triggerTime
            if (trigger !== undefined ? t >= trigger : true) {
              triggeredVisualsRef.current.add(key);
              newTriggers.push(visual);
            }
          });

          // Apply all triggered visuals — animate only if a single showMove fires
          if (newTriggers.length > 0) {
            const showMoveCount = newTriggers.filter((v) => v.type === "showMove").length;
            for (const visual of newTriggers) {
              const shouldAnimate = visual.type === "showMove" && showMoveCount === 1;
              applyVisual(visual, shouldAnimate);
            }
            if (showMoveCount === 1) {
              if (animTimeoutRef.current) clearTimeout(animTimeoutRef.current);
              animTimeoutRef.current = setTimeout(() => setAnimatingMove(null), 310);
            }
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, segments, applyVisual]);

  // Playback controls
  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.play().then(() => setIsPlaying(true)).catch(() => {});
  }, []);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
    cancelAnimationFrame(rafRef.current);
  }, []);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  const seekToSegment = useCallback(
    (index: number) => {
      if (index < 0 || index >= totalSegments) return;

      const audio = audioRef.current;
      if (audio && segments[index]) {
        audio.currentTime = segments[index].startTime;
        currentTimeRef.current = segments[index].startTime;
        setCurrentTime(segments[index].startTime);
      }

      // Clear animation
      if (animTimeoutRef.current) clearTimeout(animTimeoutRef.current);
      setAnimatingMove(null);

      resetToSegment(index);
    },
    [totalSegments, segments, resetToSegment]
  );

  const nextSegment = useCallback(() => {
    const next = Math.min(currentSegmentIndex + 1, totalSegments - 1);
    seekToSegment(next);
  }, [currentSegmentIndex, totalSegments, seekToSegment]);

  const prevSegment = useCallback(() => {
    const prev = Math.max(currentSegmentIndex - 1, 0);
    seekToSegment(prev);
  }, [currentSegmentIndex, seekToSegment]);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setIsMuted(audio.muted);
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = rate;
    setPlaybackRateState(rate);
  }, []);

  // Process first segment on load (manual mode applies all visuals immediately)
  useEffect(() => {
    if (segments.length > 0 && processedSegmentRef.current === -1 && originalFen) {
      processedSegmentRef.current = 0;
      if (isManualMode) {
        const segment = segments[0];
        if (segment) {
          segment.visuals.forEach((visual, i) => {
            triggeredVisualsRef.current.add(`0:${i}`);
            applyVisual(visual, false);
          });
        }
      }
    }
  }, [segments, originalFen, isManualMode, applyVisual]);

  // Cleanup animation timeout on unmount
  useEffect(() => {
    return () => {
      if (animTimeoutRef.current) clearTimeout(animTimeoutRef.current);
    };
  }, []);

  const currentNarration = segments[currentSegmentIndex]?.narration || "";

  return {
    board,
    highlights: activeHighlights,
    arrows: activeArrows,
    annotations: activeAnnotations,
    evalBar,
    lastMove,
    animatingMove,

    play,
    pause,
    togglePlayPause,
    seekToSegment,
    nextSegment,
    prevSegment,

    isPlaying,
    isManualMode,
    currentSegmentIndex,
    totalSegments,
    currentTime,
    currentTimeRef,
    duration,
    currentNarration,

    setPlaybackRate,
    playbackRate,
    toggleMute,
    isMuted,
    hasAudio,

    explanation,
  };
}
