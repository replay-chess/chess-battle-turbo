"use client";

import { useCallback, useRef, useState } from "react";
import { useStockfish } from "./useStockfish";
import type { UseStockfishReturn } from "./useStockfish";

export type Difficulty = "easy" | "medium" | "hard" | "expert";

interface DifficultyConfig {
  depth: number; // Stockfish search depth
  moveTime: number; // Minimum thinking time for UX (milliseconds)
  elo: number; // Approximate ELO rating for display
}

/**
 * Difficulty is controlled by Stockfish search depth and Skill Level.
 * NNUE evaluation is much stronger per depth than old pure JS, so depths are lower.
 */
const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  easy: { depth: 1, moveTime: 300, elo: 800 },
  medium: { depth: 4, moveTime: 500, elo: 1400 },
  hard: { depth: 8, moveTime: 1000, elo: 1800 },
  expert: { depth: 12, moveTime: 1500, elo: 2200 },
};

type UseBotMoveOptions = {
  engine?: Pick<UseStockfishReturn, "getBestMove" | "isReady" | "isSearching" | "stopSearch">;
  onThinkingStart?: () => void;
  onThinkingEnd?: () => void;
} & (
  | { difficulty: Difficulty; skillLevel?: never; depth?: never }
  | { difficulty?: never; skillLevel: number; depth: number; searchTimeMs?: number }
);

interface UseBotMoveReturn {
  computeBotMove: (fen: string, legalMoves: string[]) => Promise<string>;
  getThinkingTime: () => number;
  getDifficultyConfig: () => DifficultyConfig;
  isThinking: boolean;
  isEngineReady: boolean;
  cancelThinking: () => void;
}

/**
 * Hook for computing bot moves using local Stockfish engine.
 * Runs entirely in the browser via Web Worker for optimal performance.
 */
export function useBotMove(options: UseBotMoveOptions): UseBotMoveReturn {
  const { onThinkingStart, onThinkingEnd, engine } = options;
  const internalEngine = useStockfish();
  const { getBestMove, isReady, isSearching, stopSearch } = engine ?? internalEngine;
  const [isThinking, setIsThinking] = useState(false);
  const cancelledRef = useRef(false);

  const difficulty = 'difficulty' in options ? options.difficulty : undefined;
  const customSkillLevel = 'skillLevel' in options ? options.skillLevel : undefined;
  const customDepth = 'depth' in options ? options.depth : undefined;
  const customSearchTimeMs = 'searchTimeMs' in options ? options.searchTimeMs : undefined;

  const getDifficultyConfig = useCallback((): DifficultyConfig => {
    if (difficulty) return DIFFICULTIES[difficulty] || DIFFICULTIES.medium;
    return {
      depth: customDepth ?? 12,
      moveTime: Math.min(300 + (customDepth ?? 12) * 100, 2000),
      elo: 600 + (customSkillLevel ?? 20) * 80,
    };
  }, [difficulty, customDepth, customSkillLevel]);

  const getThinkingTime = useCallback((): number => {
    const config = getDifficultyConfig();
    // Add some randomness to thinking time (80% to 120% of base)
    const variance = 0.2;
    const randomFactor = 1 - variance + Math.random() * variance * 2;
    return Math.round(config.moveTime * randomFactor);
  }, [getDifficultyConfig]);

  const computeBotMove = useCallback(
    async (fen: string, legalMoves: string[]): Promise<string> => {
      if (legalMoves.length === 0) {
        throw new Error("No legal moves available");
      }

      // If only one legal move, return it immediately
      if (legalMoves.length === 1) {
        return legalMoves[0]!;
      }

      cancelledRef.current = false;
      setIsThinking(true);
      onThinkingStart?.();

      try {
        const config = getDifficultyConfig();
        const minThinkingTime = getThinkingTime();
        const startTime = Date.now();

        // Get best move from Stockfish
        const skillLevel = difficulty ? undefined : customSkillLevel;
        const searchTimeMs = difficulty ? undefined : customSearchTimeMs;
        const bestMove = await getBestMove(fen, config.depth, skillLevel, searchTimeMs);

        // Ensure minimum thinking time for better UX
        const elapsed = Date.now() - startTime;
        if (elapsed < minThinkingTime && !cancelledRef.current) {
          await new Promise((resolve) =>
            setTimeout(resolve, minThinkingTime - elapsed)
          );
        }

        if (cancelledRef.current) {
          return legalMoves[0]!; // Return first legal move if cancelled
        }

        // Find matching legal move (handle promotion format differences)
        // Stockfish returns moves in UCI format: "e2e4" or "e7e8q" (with promotion)

        // First try exact match (handles promotions correctly)
        let matchingMove = legalMoves.find((move) => move === bestMove);

        // Fallback: match by squares only (for non-promotion moves where formats might differ)
        if (!matchingMove) {
          matchingMove = legalMoves.find((move) => {
            const moveFrom = move.slice(0, 2);
            const moveTo = move.slice(2, 4);
            const bestFrom = bestMove.slice(0, 2);
            const bestTo = bestMove.slice(2, 4);
            return moveFrom === bestFrom && moveTo === bestTo;
          });
        }

        if (matchingMove) {
          return matchingMove;
        }

        // Fallback if no exact match (shouldn't happen with valid FEN)
        if (process.env.NODE_ENV === 'development') {
          console.warn("Stockfish move not found in legal moves, using first legal move");
        }
        return legalMoves[0]!;
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error("Stockfish error, using first legal move:", error);
        }
        return legalMoves[0]!;
      } finally {
        setIsThinking(false);
        onThinkingEnd?.();
      }
    },
    [getBestMove, getDifficultyConfig, getThinkingTime, onThinkingStart, onThinkingEnd, difficulty, customSkillLevel, customSearchTimeMs]
  );

  const cancelThinking = useCallback(() => {
    cancelledRef.current = true;
    stopSearch();
  }, [stopSearch]);

  return {
    computeBotMove,
    getThinkingTime,
    getDifficultyConfig,
    isThinking: isThinking || isSearching,
    isEngineReady: isReady,
    cancelThinking,
  };
}

/**
 * Export difficulty options for UI components
 */
export const DIFFICULTY_OPTIONS: Array<{
  value: Difficulty;
  label: string;
  description: string;
  elo: number;
}> = [
  { value: "easy", label: "Easy", description: "Beginner friendly", elo: 800 },
  { value: "medium", label: "Medium", description: "Club player level", elo: 1400 },
  { value: "hard", label: "Hard", description: "Advanced player", elo: 1800 },
  { value: "expert", label: "Expert", description: "Master level", elo: 2200 },
];
