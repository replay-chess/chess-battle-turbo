"use client";

import { useEffect, useRef, useState } from "react";
import type { MultiPvLine, UseStockfishReturn } from "./useStockfish";
import type { ArrowData } from "../../app/components/ChessBoard";
import type { Square } from "chess.js";

const PV_COLORS = ["green", "blue", "orange", "purple", "red"];

interface UseMultiPvAnalysisProps {
  fen: string | null;
  multiPvCount: number; // 0 = disabled
  analysisDepth: number;
  analyzePosition: UseStockfishReturn["analyzePosition"];
  stopAnalysis: () => void;
  isEngineReady: boolean;
}

interface UseMultiPvAnalysisReturn {
  lines: MultiPvLine[];
  currentDepth: number;
  arrows: ArrowData[];
}

export function useMultiPvAnalysis({
  fen,
  multiPvCount,
  analysisDepth,
  analyzePosition,
  stopAnalysis,
  isEngineReady,
}: UseMultiPvAnalysisProps): UseMultiPvAnalysisReturn {
  const [lines, setLines] = useState<MultiPvLine[]>([]);
  const [currentDepth, setCurrentDepth] = useState(0);
  const linesMapRef = useRef<Map<number, MultiPvLine>>(new Map());

  useEffect(() => {
    if (!fen || multiPvCount <= 0 || !isEngineReady) {
      setLines([]);
      setCurrentDepth(0);
      linesMapRef.current.clear();
      return;
    }

    // Clear the map but don't setLines([]) — old arrows stay visible
    // until new lines arrive, avoiding a flash/jitter on every move
    linesMapRef.current.clear();

    analyzePosition(fen, analysisDepth, multiPvCount, (line) => {
      linesMapRef.current.set(line.multipv, line);
      setCurrentDepth(line.depth);

      // Convert map to sorted array
      const sorted = Array.from(linesMapRef.current.values()).sort(
        (a, b) => a.multipv - b.multipv
      );
      setLines(sorted);
    });

    return () => {
      stopAnalysis();
      linesMapRef.current.clear();
    };
  }, [fen, multiPvCount, analysisDepth, analyzePosition, stopAnalysis, isEngineReady]);

  // Convert lines to arrows
  const arrows: ArrowData[] = lines
    .filter((line) => line.pv.length > 0)
    .map((line, i) => {
      const move = line.pv[0]!;
      return {
        from: move.slice(0, 2) as Square,
        to: move.slice(2, 4) as Square,
        color: PV_COLORS[i] ?? "yellow",
      };
    });

  return { lines, currentDepth, arrows };
}
