"use client";

import { useEffect, useRef, useCallback, useState } from "react";

export interface MultiPvLine {
  depth: number;
  multipv: number; // 1-indexed line number
  scoreCp: number | null; // centipawns (null if mate)
  scoreMate: number | null;
  pv: string[]; // UCI moves, e.g. ["e2e4", "e7e5"]
}

export interface UseStockfishReturn {
  getBestMove: (
    fen: string,
    depth: number,
    skillLevel?: number,
    searchTimeMs?: number,
  ) => Promise<string>;
  analyzePosition: (
    fen: string,
    depth: number,
    multiPvCount: number,
    onLine: (line: MultiPvLine) => void,
  ) => void;
  isReady: boolean;
  isSearching: boolean;
  stopSearch: () => void;
  restartEngine: () => void;
  error: string | null;
}

// Timeout for Stockfish to respond (15 seconds)
const STOCKFISH_TIMEOUT_MS = 15000;

export function parseStockfishInfoLine(line: string): MultiPvLine | null {
  if (!line.startsWith("info") || !line.includes(" multipv ")) return null;

  const depthMatch = line.match(/\bdepth (\d+)/);
  const multipvMatch = line.match(/\bmultipv (\d+)/);
  const scoreCpMatch = line.match(/\bscore cp (-?\d+)/);
  const scoreMateMatch = line.match(/\bscore mate (-?\d+)/);
  const pvMatch = line.match(/\bpv (.+)/);

  if (!depthMatch || !multipvMatch || !pvMatch) return null;

  return {
    depth: parseInt(depthMatch[1]!, 10),
    multipv: parseInt(multipvMatch[1]!, 10),
    scoreCp: scoreCpMatch ? parseInt(scoreCpMatch[1]!, 10) : null,
    scoreMate: scoreMateMatch ? parseInt(scoreMateMatch[1]!, 10) : null,
    pv: pvMatch[1]!.trim().split(/\s+/),
  };
}

/**
 * Hook for using Stockfish 18 chess engine via Web Worker.
 * Uses lite single-threaded WASM build with NNUE for strong play without COOP/COEP headers.
 */
export function useStockfish(enabled = true): UseStockfishReturn {
  const workerRef = useRef<Worker | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restartKey, setRestartKey] = useState(0);
  const resolveRef = useRef<((move: string) => void) | null>(null);
  const rejectRef = useRef<((error: Error) => void) | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const infoCallbackRef = useRef<((line: MultiPvLine) => void) | null>(null);
  const retryCountRef = useRef(0);

  useEffect(() => {
    // Only run on client
    if (typeof window === "undefined" || !enabled) {
      setIsReady(false);
      setIsSearching(false);
      return;
    }

    let terminated = false;
    let retryTimer: number | null = null;
    retryCountRef.current = 0;

    function disposeWorker(worker: Worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    }

    function initWorker() {
      if (terminated) return;

      if (process.env.NODE_ENV === "development") {
        console.log("[Stockfish] Initializing Web Worker...");
      }

      setIsReady(false);
      setError(null);

      // Stockfish 18 lite single-threaded WASM build (with NNUE)
      const worker = new Worker("/workers/stockfish-18-lite-single.js");
      workerRef.current = worker;

      worker.onmessage = (event) => {
        if (terminated || workerRef.current !== worker) return;
        const line = event.data as string;

        // Log important messages for debugging
        if (process.env.NODE_ENV === "development") {
          if (
            line.includes("uciok") ||
            line.includes("bestmove") ||
            line.includes("error")
          ) {
            console.log("[Stockfish]", line);
          }
        }

        // Engine ready — reset retry count on successful init
        if (line === "uciok") {
          if (process.env.NODE_ENV === "development") {
            console.log("[Stockfish] Engine ready!");
          }
          retryCountRef.current = 0;
          setIsReady(true);
        }

        // Parse info lines for MultiPV analysis
        if (line.startsWith("info") && infoCallbackRef.current) {
          const parsed = parseStockfishInfoLine(line);
          if (parsed) {
            infoCallbackRef.current(parsed);
          }
        }

        // Best move found
        if (line.startsWith("bestmove")) {
          const parts = line.split(" ");
          const move = parts[1]; // "bestmove e2e4 ponder e7e5" → "e2e4"
          if (process.env.NODE_ENV === "development") {
            console.log("[Stockfish] Best move:", move);
          }

          // Clear timeout since we got a response
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }

          // If no resolveRef, this is either an analysis completion or a stale
          // bestmove from a stop command. Don't clear infoCallbackRef here —
          // stopSearch and getBestMove manage it explicitly.
          if (!resolveRef.current) {
            setIsSearching(false);
            return;
          }

          if (move && resolveRef.current) {
            resolveRef.current(move);
            resolveRef.current = null;
            rejectRef.current = null;
          }
          setIsSearching(false);
        }
      };

      worker.onerror = (event) => {
        event.preventDefault();
        if (terminated || workerRef.current !== worker) return true;

        const message = event.message || "Unknown Web Worker error";

        // Clear timeout on error
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }

        if (rejectRef.current) {
          rejectRef.current(new Error("Stockfish worker error"));
          resolveRef.current = null;
          rejectRef.current = null;
        }
        setIsSearching(false);
        disposeWorker(worker);

        // WASM RuntimeError recovery: retry once by re-creating the worker
        if (retryCountRef.current === 0) {
          retryCountRef.current = 1;
          if (process.env.NODE_ENV === "development") {
            console.warn(
              `[Stockfish] Worker initialization failed; retrying once: ${message}`,
            );
          }
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            initWorker();
          }, 100);
        } else {
          if (process.env.NODE_ENV === "development") {
            console.warn(`[Stockfish] Worker failed after retry: ${message}`);
          }
          setError("Chess engine failed to load. Please refresh the page.");
        }

        return true;
      };

      // Initialize UCI protocol
      worker.postMessage("uci");
    }

    initWorker();

    return () => {
      terminated = true;
      if (process.env.NODE_ENV === "development") {
        console.log("[Stockfish] Terminating worker");
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      const worker = workerRef.current;
      if (worker) disposeWorker(worker);
    };
  }, [enabled, restartKey]);

  const getBestMove = useCallback(
    (
      fen: string,
      depth: number,
      skillLevel?: number,
      searchTimeMs?: number,
    ): Promise<string> => {
      return new Promise((resolve, reject) => {
        if (!workerRef.current) {
          if (process.env.NODE_ENV === "development") {
            console.error("[Stockfish] Worker not initialized");
          }
          reject(new Error("Stockfish worker not initialized"));
          return;
        }

        if (!isReady) {
          if (process.env.NODE_ENV === "development") {
            console.warn("[Stockfish] Engine not ready yet, rejecting request");
          }
          reject(new Error("Stockfish not ready"));
          return;
        }

        // Clear any existing timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        // Clear any active analysis callback so it doesn't interfere
        infoCallbackRef.current = null;

        resolveRef.current = resolve;
        rejectRef.current = reject;
        setIsSearching(true);

        // Set timeout to prevent hanging
        timeoutRef.current = setTimeout(() => {
          if (process.env.NODE_ENV === "development") {
            console.error(
              "[Stockfish] Timeout - no response in",
              STOCKFISH_TIMEOUT_MS,
              "ms",
            );
          }
          if (rejectRef.current) {
            rejectRef.current(new Error("Stockfish timeout"));
            resolveRef.current = null;
            rejectRef.current = null;
          }
          setIsSearching(false);

          // Try to stop the current search
          workerRef.current?.postMessage("stop");
        }, STOCKFISH_TIMEOUT_MS);

        const worker = workerRef.current;
        if (process.env.NODE_ENV === "development") {
          console.log(
            `[Stockfish] Searching: depth=${depth}, skillLevel=${skillLevel}, searchTimeMs=${searchTimeMs}`,
          );
          console.log(`[Stockfish] FEN: ${fen}`);
        }

        // Send UCI commands
        worker.postMessage("ucinewgame");
        worker.postMessage("setoption name MultiPV value 1");
        if (skillLevel !== undefined) {
          worker.postMessage(`setoption name Skill Level value ${skillLevel}`);
        }
        worker.postMessage("isready");
        worker.postMessage(`position fen ${fen}`);
        // Use movetime to cap search duration when specified, depth still limits max depth
        const goCmd = searchTimeMs
          ? `go depth ${depth} movetime ${searchTimeMs}`
          : `go depth ${depth}`;
        worker.postMessage(goCmd);
      });
    },
    [isReady],
  );

  const stopSearch = useCallback(() => {
    if (process.env.NODE_ENV === "development") {
      console.log("[Stockfish] Stopping search");
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    workerRef.current?.postMessage("stop");
    setIsSearching(false);
    resolveRef.current = null;
    rejectRef.current = null;
    infoCallbackRef.current = null;
  }, []);

  const analyzePosition = useCallback(
    (
      fen: string,
      depth: number,
      multiPvCount: number,
      onLine: (line: MultiPvLine) => void,
    ) => {
      if (!workerRef.current || !isReady) return;

      // Stop any ongoing search
      workerRef.current.postMessage("stop");
      resolveRef.current = null;
      rejectRef.current = null;

      // Set up analysis callback (no resolveRef — fire-and-forget)
      // Don't set isSearching — analysis is background work that shouldn't
      // trigger isBotThinking or cause cascading re-renders
      infoCallbackRef.current = onLine;

      const worker = workerRef.current;
      worker.postMessage(`setoption name MultiPV value ${multiPvCount}`);
      worker.postMessage("isready");
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`go depth ${depth}`);
    },
    [isReady],
  );

  const restartEngine = useCallback(() => {
    retryCountRef.current = 0;
    setError(null);
    setIsReady(false);
    setIsSearching(false);
    setRestartKey((value) => value + 1);
  }, []);

  return {
    getBestMove,
    analyzePosition,
    isReady,
    isSearching,
    stopSearch,
    restartEngine,
    error,
  };
}
