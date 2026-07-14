"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useStockfish, type MultiPvLine } from "@/lib/hooks/useStockfish";

interface ArticleAnalysisRequest {
  boardId: string;
  fen: string;
  count: number;
  depth?: number;
  onLine: (line: MultiPvLine) => void;
}

interface ActiveRequest extends ArticleAnalysisRequest {
  token: number;
}

interface ArticleStockfishContextValue {
  analyze: (request: ArticleAnalysisRequest) => void;
  cancel: (boardId: string) => void;
  retry: () => void;
  activeBoardId: string | null;
  isReady: boolean;
  error: string | null;
}

const ArticleStockfishContext =
  createContext<ArticleStockfishContextValue | null>(null);

export function ArticleStockfishProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [engineEnabled, setEngineEnabled] = useState(false);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const engine = useStockfish(engineEnabled);
  const analyzePosition = engine.analyzePosition;
  const stopSearch = engine.stopSearch;
  const restartEngine = engine.restartEngine;
  const isEngineReady = engine.isReady;
  const engineError = engine.error;
  const requestRef = useRef<ActiveRequest | null>(null);
  const requestTokenRef = useRef(0);

  const startRequest = useCallback(
    (request: ActiveRequest) => {
      if (!isEngineReady) return;
      analyzePosition(
        request.fen,
        request.depth ?? 16,
        request.count,
        (line) => {
          if (requestRef.current?.token !== request.token) return;
          request.onLine(line);
        },
      );
    },
    [analyzePosition, isEngineReady],
  );

  const analyze = useCallback(
    (request: ArticleAnalysisRequest) => {
      const active: ActiveRequest = {
        ...request,
        token: ++requestTokenRef.current,
      };
      requestRef.current = active;
      setActiveBoardId(request.boardId);
      setEngineEnabled(true);
      if (isEngineReady) startRequest(active);
    },
    [isEngineReady, startRequest],
  );

  const cancel = useCallback(
    (boardId: string) => {
      if (requestRef.current?.boardId !== boardId) return;
      requestTokenRef.current += 1;
      requestRef.current = null;
      setActiveBoardId(null);
      stopSearch();
    },
    [stopSearch],
  );

  const retry = useCallback(() => {
    setEngineEnabled(true);
    restartEngine();
  }, [restartEngine]);

  useEffect(() => {
    const request = requestRef.current;
    if (isEngineReady && request) startRequest(request);
  }, [isEngineReady, startRequest]);

  useEffect(
    () => () => {
      requestRef.current = null;
      stopSearch();
    },
    [stopSearch],
  );

  const value = useMemo<ArticleStockfishContextValue>(
    () => ({
      analyze,
      cancel,
      retry,
      activeBoardId,
      isReady: isEngineReady,
      error: engineError,
    }),
    [activeBoardId, analyze, cancel, engineError, isEngineReady, retry],
  );

  return (
    <ArticleStockfishContext.Provider value={value}>
      {children}
    </ArticleStockfishContext.Provider>
  );
}

export function useArticleStockfish(): ArticleStockfishContextValue {
  const value = useContext(ArticleStockfishContext);
  if (!value) {
    throw new Error(
      "InteractiveAnalysisBoard must be rendered inside ArticleStockfishProvider.",
    );
  }
  return value;
}
