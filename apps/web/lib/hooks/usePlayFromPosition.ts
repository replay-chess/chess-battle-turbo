"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Chess, Move, Color, Square } from "chess.js";
import { useStockfish } from "./useStockfish";
import type { UseStockfishReturn } from "./useStockfish";
import { useBotMove } from "./useBotMove";
import { useChessSound } from "./useChessSound";
import type { BoardState } from "./useAnalysisBoard";

interface UsePlayFromPositionProps {
  startingFen: string | null; // null = not active
  playerColor: Color;
  resetKey?: number; // bump to force re-init even for the same FEN
  skillLevel?: number; // 0-20
  depth?: number; // 1-20
  searchTimeMs?: number; // max search time in ms
  disableBot?: boolean; // when true, user plays both sides (no auto bot moves)
}

interface UsePlayFromPositionReturn {
  // Board state
  board: BoardState;
  selectedSquare: Square | null;
  legalMoves: Square[];
  lastMove: { from: Square; to: Square } | null;

  // Interaction
  handleSquareClick: (square: Square) => void;

  // Promotion
  pendingPromotion: { from: Square; to: Square } | null;
  handlePromotionSelect: (piece: "q" | "r" | "b" | "n") => void;

  // Game state
  moveHistory: Move[];
  isPlayerTurn: boolean;
  isBotThinking: boolean;
  isEngineReady: boolean;
  gameOver: boolean;
  gameOverReason: string | null;
  gameResult: "win" | "loss" | "draw" | null;

  // Actions
  resetGame: () => void;

  // Board flip
  isFlipped: boolean;
  toggleFlip: () => void;

  // Engine analysis
  currentFen: string;
  analyzePosition: UseStockfishReturn["analyzePosition"];
  stopAnalysis: () => void;
}

function getGameOverInfo(
  game: Chess,
  playerColor: Color
): { reason: string; result: "win" | "loss" | "draw" } | null {
  if (!game.isGameOver()) return null;

  if (game.isCheckmate()) {
    // The side whose turn it is has been checkmated
    const loser = game.turn();
    return {
      reason: "Checkmate",
      result: loser === playerColor ? "loss" : "win",
    };
  }
  if (game.isStalemate()) return { reason: "Stalemate", result: "draw" };
  if (game.isInsufficientMaterial())
    return { reason: "Insufficient Material", result: "draw" };
  if (game.isThreefoldRepetition())
    return { reason: "Threefold Repetition", result: "draw" };
  if (game.isDraw()) return { reason: "Draw", result: "draw" };

  return { reason: "Game Over", result: "draw" };
}

export function usePlayFromPosition({
  startingFen,
  playerColor,
  resetKey = 0,
  skillLevel,
  depth,
  searchTimeMs,
  disableBot = false,
}: UsePlayFromPositionProps): UsePlayFromPositionReturn {
  const [game, setGame] = useState<Chess>(new Chess());
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalMoves, setLegalMoves] = useState<Square[]>([]);
  const [moveHistory, setMoveHistory] = useState<Move[]>([]);
  const [lastMove, setLastMove] = useState<{
    from: Square;
    to: Square;
  } | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: Square;
    to: Square;
  } | null>(null);
  const [gameOver, setGameOver] = useState(false);
  const [gameOverReason, setGameOverReason] = useState<string | null>(null);
  const [gameResult, setGameResult] = useState<"win" | "loss" | "draw" | null>(
    null
  );
  const [isFlipped, setIsFlipped] = useState(playerColor === "b");

  // Track what we've initialized from so we detect changes synchronously
  const [initState, setInitState] = useState<{ fen: string | null; key: number }>({
    fen: null,
    key: -1,
  });

  const botMoveInProgressRef = useRef(false);

  const { playSoundForMove, playSound } = useChessSound();
  const engine = useStockfish();
  const botConfig = (skillLevel !== undefined && depth !== undefined)
    ? { skillLevel, depth, searchTimeMs }
    : { difficulty: "expert" as const };
  const { computeBotMove, isThinking: isBotThinking, isEngineReady } = useBotMove({
    ...botConfig,
    engine,
  });

  // Synchronous initialization when startingFen or resetKey changes — runs during render
  // so the board is correct on the very first frame (no flash of default position)
  if (startingFen && (startingFen !== initState.fen || resetKey !== initState.key)) {
    const newGame = new Chess(startingFen);
    setGame(newGame);
    setInitState({ fen: startingFen, key: resetKey });
    setSelectedSquare(null);
    setLegalMoves([]);
    setMoveHistory([]);
    setLastMove(null);
    setPendingPromotion(null);
    setGameOver(false);
    setGameOverReason(null);
    setGameResult(null);
    setIsFlipped(playerColor === "b");
    botMoveInProgressRef.current = false;
  }

  const currentTurn = game.turn();
  const isPlayerTurn = currentTurn === playerColor && !gameOver;

  const checkGameOver = useCallback(
    (g: Chess) => {
      const info = getGameOverInfo(g, playerColor);
      if (info) {
        setGameOver(true);
        setGameOverReason(info.reason);
        setGameResult(info.result);
        playSound("game-end");
        return true;
      }
      return false;
    },
    [playerColor, playSound]
  );

  // Apply a move to the game and update state
  const applyMove = useCallback(
    (from: Square, to: Square, promotion?: "q" | "r" | "b" | "n") => {
      const newGame = new Chess(game.fen());
      try {
        const move = newGame.move({ from, to, promotion });
        setGame(newGame);
        setMoveHistory((prev) => [...prev, move]);
        setLastMove({ from: move.from as Square, to: move.to as Square });
        if (!newGame.isGameOver()) {
          playSoundForMove(move.san);
        }
        checkGameOver(newGame);
        return move;
      } catch {
        return null;
      }
    },
    [game, playSoundForMove, checkGameOver]
  );

  const getLegalMovesForSquare = useCallback(
    (square: Square): Square[] => {
      const moves = game.moves({ square, verbose: true });
      return moves.map((m) => m.to);
    },
    [game]
  );

  const isPromotionMove = useCallback(
    (from: Square, to: Square): boolean => {
      const moves = game.moves({ square: from, verbose: true });
      const targetMove = moves.find((m) => m.to === to);
      return targetMove?.isPromotion() ?? false;
    },
    [game]
  );

  const handlePromotionSelect = useCallback(
    (piece: "q" | "r" | "b" | "n") => {
      if (!pendingPromotion) return;
      applyMove(pendingPromotion.from, pendingPromotion.to, piece);
      setPendingPromotion(null);
      setSelectedSquare(null);
      setLegalMoves([]);
    },
    [pendingPromotion, applyMove]
  );

  const handleSquareClick = useCallback(
    (square: Square) => {
      if (gameOver) return;
      // When disableBot, user plays both sides; otherwise only on their turn
      if (!disableBot && !isPlayerTurn) return;

      // Which color can move right now
      const activeColor = disableBot ? game.turn() : playerColor;

      // No piece selected yet — try to select one
      if (!selectedSquare) {
        const piece = game.get(square);
        if (piece && piece.color === activeColor) {
          setSelectedSquare(square);
          setLegalMoves(getLegalMovesForSquare(square));
        }
        return;
      }

      // Clicked same square — deselect
      if (selectedSquare === square) {
        setSelectedSquare(null);
        setLegalMoves([]);
        return;
      }

      // Clicked another piece of the active color — reselect
      const piece = game.get(square);
      if (piece && piece.color === activeColor) {
        setSelectedSquare(square);
        setLegalMoves(getLegalMovesForSquare(square));
        return;
      }

      const from = selectedSquare;
      const to = square;

      // Check promotion
      if (isPromotionMove(from, to)) {
        setPendingPromotion({ from, to });
        return;
      }

      applyMove(from, to);
      setSelectedSquare(null);
      setLegalMoves([]);
    },
    [
      gameOver,
      disableBot,
      isPlayerTurn,
      selectedSquare,
      game,
      playerColor,
      getLegalMovesForSquare,
      isPromotionMove,
      applyMove,
    ]
  );

  // Bot move effect — skipped when disableBot (user plays both sides)
  useEffect(() => {
    if (disableBot) return;
    if (!startingFen) return;
    if (gameOver) return;
    if (currentTurn === playerColor) return;
    if (botMoveInProgressRef.current) return;
    if (!isEngineReady) return;

    const gameLegalMoves = game.moves({ verbose: true });
    if (gameLegalMoves.length === 0) return;

    botMoveInProgressRef.current = true;
    const currentFen = game.fen();
    const legalMovesUCI = gameLegalMoves.map(
      (m) => `${m.from}${m.to}${m.promotion || ""}`
    );

    const makeBotMove = async () => {
      try {
        const botMoveUCI = await computeBotMove(currentFen, legalMovesUCI);
        const from = botMoveUCI.slice(0, 2) as Square;
        const to = botMoveUCI.slice(2, 4) as Square;
        const promotion =
          botMoveUCI.length > 4
            ? (botMoveUCI[4] as "q" | "r" | "b" | "n")
            : undefined;

        const newGame = new Chess(currentFen);
        try {
          const move = newGame.move({ from, to, promotion });
          setGame(newGame);
          setMoveHistory((prev) => [...prev, move]);
          setLastMove({ from: move.from as Square, to: move.to as Square });
          setSelectedSquare(null);
          setLegalMoves([]);
          if (!newGame.isGameOver()) {
            playSoundForMove(move.san);
          }

          const info = getGameOverInfo(newGame, playerColor);
          if (info) {
            setGameOver(true);
            setGameOverReason(info.reason);
            setGameResult(info.result);
            playSound("game-end");
          }
        } catch {
          if (process.env.NODE_ENV === "development") {
            console.error("Failed to apply bot move:", botMoveUCI);
          }
        }
      } catch (error) {
        if (process.env.NODE_ENV === "development") {
          console.error("Error computing bot move:", error);
        }
      } finally {
        botMoveInProgressRef.current = false;
      }
    };

    makeBotMove();
  }, [
    disableBot,
    startingFen,
    gameOver,
    currentTurn,
    playerColor,
    game,
    computeBotMove,
    playSoundForMove,
    playSound,
    isEngineReady,
  ]);

  // Clear selection when game ends
  useEffect(() => {
    if (gameOver) {
      setSelectedSquare(null);
      setLegalMoves([]);
      setPendingPromotion(null);
    }
  }, [gameOver]);

  const resetGame = useCallback(() => {
    if (!startingFen) return;
    const newGame = new Chess(startingFen);
    setGame(newGame);
    setSelectedSquare(null);
    setLegalMoves([]);
    setMoveHistory([]);
    setLastMove(null);
    setPendingPromotion(null);
    setGameOver(false);
    setGameOverReason(null);
    setGameResult(null);
    botMoveInProgressRef.current = false;
  }, [startingFen]);

  const toggleFlip = useCallback(() => {
    setIsFlipped((prev) => !prev);
  }, []);

  return {
    board: game.board(),
    selectedSquare,
    legalMoves,
    lastMove,
    handleSquareClick,
    pendingPromotion,
    handlePromotionSelect,
    moveHistory,
    isPlayerTurn,
    isBotThinking,
    isEngineReady,
    gameOver,
    gameOverReason,
    gameResult,
    resetGame,
    isFlipped,
    toggleFlip,
    currentFen: game.fen(),
    analyzePosition: engine.analyzePosition,
    stopAnalysis: engine.stopSearch,
  };
}
