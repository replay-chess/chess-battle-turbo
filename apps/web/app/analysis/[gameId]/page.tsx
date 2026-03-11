"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { Chess, Move, Color } from "chess.js";
import { useRouter } from "next/navigation";
import ChessBoard from "../../components/ChessBoard";
import AnalysisMoveList from "../../components/AnalysisMoveList";
import { PromotionPopup } from "../../components/PromotionPopup";
import { Navbar } from "../../components/Navbar";
import PracticeMoveList from "./PracticeMoveList";
import ExplanationView, { ExplanationComingSoon } from "./ExplanationView";
import NarrationDisplay from "./NarrationDisplay";
import SegmentList from "./SegmentList";
import { useAnalysisBoard } from "@/lib/hooks/useAnalysisBoard";
import { usePlayFromPosition } from "@/lib/hooks/usePlayFromPosition";
import { useExplanationPlayer } from "@/lib/hooks/useExplanationPlayer";
import { useRequireAuth, UseRequireAuthReturn } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { trackApiResponseTime } from "@/lib/metrics";
import { motion } from "motion/react";
import type { ExplanationData } from "@/lib/hooks/useExplanationPlayer";

type AnalysisTab = "explanation" | "your-moves" | "legend-moves" | "practice";

const DEFAULT_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function computeFenAtPly(startingFen: string, moves: Move[], plyIndex: number): string {
  const game = new Chess(startingFen);
  const movesToReplay = Math.min(Math.max(0, plyIndex), moves.length);
  for (let i = 0; i < movesToReplay; i++) {
    const move = moves[i];
    if (move) {
      try {
        game.move({ from: move.from, to: move.to, promotion: move.promotion });
      } catch {
        break;  
      }
    }
  }
  return game.fen();
}

interface AnalysisData {
  gameReferenceId: string;
  startingFen: string;
  userMoves: Move[];
  userColor: "w" | "b";
  gameResult: string | null;
  userGameOutcome: "win" | "loss" | "draw" | null;
  legendMoves: Move[];
  moveNumberStart: number;
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  tournamentName: string | null;
  legendPgn: string | null;
  legendGameResult: "white_won" | "black_won" | "draw" | null;
  openingName: string | null;
  openingEco: string | null;
  explanation: ExplanationData | null;
  explanationAudioUrl: string | null;
}

const AnalysisPage = ({ params }: { params: Promise<{ gameId: string }> }) => {
  const router = useRouter();
  const { gameId } = use(params);
  const { isReady, userObject }: UseRequireAuthReturn = useRequireAuth();
  const userReferenceId = userObject?.user?.referenceId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalysisData | null>(null);

  // Fetch analysis data
  useEffect(() => {
    if (!isReady) return;

    const fetchData = async () => {
      try {
        const url = userReferenceId
          ? `/api/analysis/${gameId}?userReferenceId=${userReferenceId}`
          : `/api/analysis/${gameId}`;
        const start = Date.now();
        const response = await fetch(url);
        const result = await response.json();
        trackApiResponseTime("analysis.fetch", Date.now() - start);

        if (!result.success) {
          setError(result.error || "Failed to load analysis data");
          return;
        }

        setData(result.data);
      } catch (err) {
        setError("Failed to load analysis data");
        logger.error("Failed to load analysis data", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [gameId, isReady, userReferenceId]);

  // Tab state — default depends on whether explanation data exists
  const [activeTab, setActiveTab] = useState<AnalysisTab>("legend-moves");
  const [practiceFen, setPracticeFen] = useState<string | null>(null);
  const [practiceKey, setPracticeKey] = useState(0); // bumped to force reset even for same FEN
  const previousTabRef = useRef<AnalysisTab>("legend-moves");

  // Set default tab once data loads
  useEffect(() => {
    if (!data) return;
    if (data.explanation) {
      setActiveTab("explanation");
      previousTabRef.current = "explanation";
    } else if (data.legendMoves.length > 0) {
      setActiveTab("legend-moves");
      previousTabRef.current = "legend-moves";
    } else {
      setActiveTab("your-moves");
      previousTabRef.current = "your-moves";
    }
  }, [data]);

  // Initialize analysis board hook
  const analysisBoard = useAnalysisBoard({
    startingFen: data?.startingFen || "",
    userMoves: data?.userMoves || [],
    legendMoves: data?.legendMoves || [],
    userColor: (data?.userColor || "w") as Color,
    legendPgn: data?.legendPgn,
    moveNumberStart: data?.moveNumberStart,
    isLegendMode: activeTab === "legend-moves",
    enableKeyboardNav: activeTab !== "practice" && activeTab !== "explanation",
  });

  // Practice game hook
  const practiceGame = usePlayFromPosition({
    startingFen: practiceFen,
    playerColor: (data?.userColor || "w") as Color,
    resetKey: practiceKey,
  });

  // Explanation player hook
  const explanationPlayer = useExplanationPlayer(
    data?.explanation as ExplanationData | null,
    data?.explanationAudioUrl ?? null
  );
  const hasExplanation = !!(data?.explanation && (data.explanation as ExplanationData).segments?.length > 0);

  const {
    plyIndex,
    maxPly,
    userBoard,
    legendBoard,
    goToFirst,
    goBack,
    goForward,
    goToLast,
    goToPly,
    isAtStart,
    isAtEnd,
    divergences,
    userLastMove,
    legendLastMove,
    isFlipped,
    toggleFlip,
    gameStartPly,
    fullLegendMoves,
  } = analysisBoard;

  // Handle switching to practice tab — capture FEN from current position
  const handlePracticeTabClick = useCallback(() => {
    if (!data) return;
    previousTabRef.current = activeTab !== "practice" ? activeTab : previousTabRef.current;

    let fen: string;
    if (activeTab === "legend-moves" && fullLegendMoves.length > 0) {
      fen = computeFenAtPly(DEFAULT_FEN, fullLegendMoves, gameStartPly + plyIndex);
    } else {
      fen = computeFenAtPly(data.startingFen, data.userMoves, Math.max(0, plyIndex));
    }
    setPracticeFen(fen);
    setPracticeKey((k) => k + 1);
    setActiveTab("practice");
  }, [data, activeTab, fullLegendMoves, gameStartPly, plyIndex]);

  const handleBackToAnalysis = useCallback(() => {
    setActiveTab(previousTabRef.current);
  }, []);

  // Keyboard shortcuts for explanation mode (arrow keys + space)
  useEffect(() => {
    if (activeTab !== "explanation" || !explanationPlayer.hasAudio) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        explanationPlayer.skipBack();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        explanationPlayer.skipForward();
      } else if (e.key === " ") {
        e.preventDefault();
        explanationPlayer.togglePlayPause();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, explanationPlayer.hasAudio, explanationPlayer.skipBack, explanationPlayer.skipForward, explanationPlayer.togglePlayPause]);

  // Pause explanation audio when leaving the tab, resume when returning
  const wasPlayingRef = useRef(false);
  useEffect(() => {
    if (activeTab === "explanation") {
      // Returning to explanation tab — resume if it was playing before
      if (wasPlayingRef.current) {
        explanationPlayer.play();
        wasPlayingRef.current = false;
      }
    } else {
      // Leaving explanation tab — pause if playing and remember state
      if (explanationPlayer.isPlaying) {
        wasPlayingRef.current = true;
        explanationPlayer.pause();
      }
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps -- only react to tab changes

  // Determine starting side from FEN
  const startingSide =
    data?.startingFen?.split(" ")[1] === "b" ? "b" : "w";

  // Determine which board flip to use
  const currentFlipped = activeTab === "practice" ? practiceGame.isFlipped : isFlipped;
  const currentToggleFlip = activeTab === "practice" ? practiceGame.toggleFlip : toggleFlip;

  // Practice board starting side (from practice FEN)
  const practiceFenSide = practiceFen?.split(" ")[1] === "b" ? "b" : "w";

  if (!isReady || loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="w-10 h-10 border border-white/20 border-t-white/60 rounded-full animate-spin mb-6" />
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-white/40 text-xs tracking-[0.2em] uppercase"
          >
            Loading Analysis
          </p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <p
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="text-white text-xl mb-4"
          >
            {error || "Analysis data not found"}
          </p>
          <button
            onClick={() => router.push("/play")}
            className="px-6 py-2 border border-white/20 text-white/60 hover:border-white/40 hover:text-white transition-colors"
            style={{ fontFamily: "'Geist', sans-serif" }}
          >
            Back to Play
          </button>
        </div>
      </div>
    );
  }

  const hasLegendMoves = data.legendMoves.length > 0;
  const isOpeningGame = !!data.openingName;

  return (
    <div className="min-h-screen bg-black text-white overflow-auto">
      {/* Navbar */}
      <Navbar />

      {/* Subtle grid background */}
      <div
        className="fixed inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative max-w-7xl mx-auto px-0 sm:px-8 md:px-8 lg:px-4 pb-4 md:pb-6 lg:pb-8 pt-16 sm:pt-20 md:pt-24 lg:pt-32 min-h-[100dvh] flex flex-col justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col lg:grid lg:grid-cols-12 gap-0 lg:gap-8 min-h-0"
        >
          {/* Left - Move List / Segment List (hidden on mobile) */}
          <div className="lg:col-span-3 order-2 lg:order-1 hidden lg:flex lg:flex-col">
            <div className={cn(
              "border flex flex-col max-h-[70vh] overflow-hidden",
              activeTab === "explanation" ? "border-emerald-500/20" :
              activeTab === "practice" ? "border-amber-500/20" : "border-white/10"
            )}>
              {activeTab === "explanation" ? (
                hasExplanation ? (
                  <>
                    <div className="p-3 border-b border-white/10">
                      <p
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-[10px] tracking-[0.3em] uppercase text-emerald-400/60"
                      >
                        Segments
                      </p>
                    </div>
                    <SegmentList
                      explanation={data.explanation as ExplanationData}
                      currentSegmentIndex={explanationPlayer.currentSegmentIndex}
                      onSegmentClick={explanationPlayer.seekToSegment}
                    />
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center p-4">
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-white/30 text-sm text-center"
                    >
                      No explanation available
                    </p>
                  </div>
                )
              ) : activeTab === "practice" ? (
                <PracticeMoveList
                  moveHistory={practiceGame.moveHistory}
                  isBotThinking={practiceGame.isBotThinking}
                  gameOver={practiceGame.gameOver}
                  gameOverReason={practiceGame.gameOverReason}
                  gameResult={practiceGame.gameResult}
                  onReset={practiceGame.resetGame}
                  onBackToAnalysis={handleBackToAnalysis}
                  playerColor={(data.userColor || "w") as Color}
                  startingSide={practiceFenSide as "w" | "b"}
                />
              ) : (
                <>
                  <div className="p-4 border-b border-white/10">
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-[10px] tracking-[0.3em] uppercase text-white/40"
                    >
                      {isOpeningGame
                        ? "Your Moves"
                        : activeTab === "legend-moves"
                          ? "Legend Game"
                          : "Your Moves"}
                    </p>
                  </div>
                  {hasLegendMoves ? (
                    <AnalysisMoveList
                      userMoves={data?.userMoves || []}
                      currentPlyIndex={plyIndex}
                      onPlyClick={goToPly}
                      moveNumberStart={data.moveNumberStart}
                      startingSide={startingSide as "w" | "b"}
                      isLegendMode={activeTab === "legend-moves"}
                      fullLegendMoves={fullLegendMoves}
                      gameStartPly={gameStartPly}
                    />
                  ) : (
                    <div className="flex-1 flex items-center justify-center p-4">
                      <p
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-white/30 text-sm text-center"
                      >
                        {isOpeningGame
                          ? "Review your moves from this opening"
                          : "No legend moves available for comparison"}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Center - Chess Board */}
          <div className="lg:col-span-6 order-1 lg:order-2 flex flex-col lg:block">
            {/* Compact Header */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mb-1 lg:mb-1 px-2"
            >
              {/* Two-line header */}
              <div className="flex flex-col items-center gap-0.5">
                {/* Line 1: Opening name OR Tournament + Players */}
                <div className="flex items-center justify-center gap-1.5 lg:gap-2 flex-wrap">
                  {isOpeningGame ? (
                    <div className="flex items-center gap-2">
                      {data.openingEco && (
                        <span
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="text-[10px] tracking-wider text-white/50 bg-white/10 px-1.5 py-0.5 uppercase"
                        >
                          {data.openingEco}
                        </span>
                      )}
                      <span
                        style={{ fontFamily: "'Instrument Serif', serif" }}
                        className="text-white/50 text-sm lg:text-base italic"
                      >
                        {data.openingName}
                      </span>
                    </div>
                  ) : (
                    <>
                      {data.tournamentName && (
                        <>
                          <span
                            style={{ fontFamily: "'Geist', sans-serif" }}
                            className="text-white/25 text-[10px] lg:text-xs"
                          >
                            {data.tournamentName}
                          </span>
                          {(data.whitePlayerName || data.blackPlayerName) && (
                            <span className="text-white/20">·</span>
                          )}
                        </>
                      )}
                      {(data.whitePlayerName || data.blackPlayerName) && (
                        <div className="flex items-center gap-1.5 lg:gap-2">
                          <span
                            style={{ fontFamily: "'Instrument Serif', serif" }}
                            className="text-sky-300/60 text-sm lg:text-base"
                          >
                            {data.whitePlayerName || "White"}
                          </span>
                          {data.legendGameResult && (
                            <span
                              style={{ fontFamily: "'Geist', sans-serif" }}
                              className="text-sky-400/70 text-xs lg:text-sm font-medium"
                            >
                              {data.legendGameResult === "white_won" && "1–0"}
                              {data.legendGameResult === "black_won" && "0–1"}
                              {data.legendGameResult === "draw" && "½–½"}
                            </span>
                          )}
                          {!data.legendGameResult && (
                            <span className="text-white/20 text-xs">vs</span>
                          )}
                          <span
                            style={{ fontFamily: "'Instrument Serif', serif" }}
                            className="text-sky-300/60 text-sm lg:text-base"
                          >
                            {data.blackPlayerName || "Black"}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Line 2: Your result + move info */}
                <div className="flex items-center justify-center gap-1.5 lg:gap-2">
                  {data.userGameOutcome && (
                    <div className="flex items-center gap-1.5">
                      <span
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-white/40 text-[10px] lg:text-xs uppercase tracking-wider"
                      >
                        You
                      </span>
                      <span
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className={cn(
                          "text-xs lg:text-sm font-medium px-1.5 py-0.5",
                          data.userGameOutcome === "win" && "text-amber-400 bg-amber-400/10",
                          data.userGameOutcome === "loss" && "text-white/50 bg-white/5",
                          data.userGameOutcome === "draw" && "text-white/50 bg-white/5"
                        )}
                      >
                        {data.userGameOutcome === "win" && "Won"}
                        {data.userGameOutcome === "loss" && "Lost"}
                        {data.userGameOutcome === "draw" && "Drew"}
                      </span>
                      <span
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-white/30 text-[10px] lg:text-xs"
                      >
                        as {data.userColor === "w" ? "White" : "Black"}
                      </span>
                    </div>
                  )}
                  {data.userGameOutcome && !isOpeningGame && (
                    <span className="text-white/15">·</span>
                  )}
                  {!isOpeningGame && (
                    <span
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-white/30 text-[10px] lg:text-xs"
                    >
                      from move {data.moveNumberStart}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>

            {/* Tabs - Mobile Only */}
            <div className="flex items-center justify-center gap-2 md:gap-3 mb-3 sm:mb-3 md:mb-4 px-2 lg:hidden">
              <button
                onClick={() => setActiveTab("explanation")}
                className={cn(
                  "px-3 md:px-4 py-2 md:py-2 text-xs md:text-sm tracking-wide border transition-colors",
                  activeTab === "explanation"
                    ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                    : "border-white/10 text-white/40 hover:text-white/60 hover:border-white/20"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                Explain
              </button>
              {hasLegendMoves && (
                <button
                  onClick={() => setActiveTab("legend-moves")}
                  className={cn(
                    "px-3 md:px-4 py-2 md:py-2 text-xs md:text-sm tracking-wide border transition-colors",
                    activeTab === "legend-moves"
                      ? "border-sky-500/40 text-sky-400 bg-sky-500/10"
                      : "border-white/10 text-white/40 hover:text-white/60 hover:border-white/20"
                  )}
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  Legend&apos;s Moves
                </button>
              )}
              <button
                onClick={() => setActiveTab("your-moves")}
                className={cn(
                  "px-3 md:px-4 py-2 md:py-2 text-xs md:text-sm tracking-wide border transition-colors",
                  activeTab === "your-moves"
                    ? "border-white/40 text-white bg-white/10"
                    : "border-white/10 text-white/40 hover:text-white/60 hover:border-white/20"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                Your Moves
              </button>
              <button
                onClick={handlePracticeTabClick}
                className={cn(
                  "px-3 md:px-4 py-2 md:py-2 text-xs md:text-sm tracking-wide border transition-colors",
                  activeTab === "practice"
                    ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
                    : "border-white/10 text-white/40 hover:text-white/60 hover:border-white/20"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                Practice
              </button>
            </div>

            {/* Turn indicator — explanation mode only */}
            {activeTab === "explanation" && hasExplanation && (
              <div className="flex justify-center mb-1 px-2">
                <div className="flex items-center gap-2 border border-white/10 bg-white/[0.03] px-2.5 py-1.5 sm:px-2 sm:py-1">
                  <div className={`w-3.5 h-3.5 sm:w-3 sm:h-3 rounded-full border ${explanationPlayer.turn === "w" ? "bg-white border-white/40" : "bg-zinc-800 border-white/25"}`} />
                  <span
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-xs sm:text-[11px] tracking-wider text-white/60 uppercase font-medium"
                  >
                    {explanationPlayer.turn === "w" ? "White" : "Black"} to move
                  </span>
                </div>
              </div>
            )}

            {/* Board */}
            <div className="mx-1 sm:p-5 md:p-5 lg:p-0 lg:mt-6 lg:mb-4 lg:mx-0">
              {activeTab === "explanation" ? (
                hasExplanation ? (
                  <ExplanationView
                    explanation={data.explanation as ExplanationData}
                    player={explanationPlayer}
                    playerColor={(data.userColor || "w") as Color}
                  />
                ) : (
                  <ExplanationComingSoon />
                )
              ) : activeTab === "practice" ? (
                <ChessBoard
                  board={practiceGame.board}
                  playerColor={practiceGame.isFlipped ? "b" : "w"}
                  showCoordinates={true}
                  selectedSquare={practiceGame.selectedSquare}
                  legalMoves={practiceGame.legalMoves}
                  onSquareClick={practiceGame.handleSquareClick}
                  lastMove={practiceGame.lastMove}
                  isInteractive={!practiceGame.gameOver}
                  gameEndState={
                    practiceGame.gameResult === "win"
                      ? "victory"
                      : practiceGame.gameResult === "loss"
                        ? "defeat"
                        : practiceGame.gameResult === "draw"
                          ? "draw"
                          : null
                  }
                  squareSize="responsive-md"
                />
              ) : (
                <ChessBoard
                  board={activeTab === "legend-moves" ? legendBoard : userBoard}
                  playerColor={isFlipped ? "b" : "w"}
                  showCoordinates={true}
                  lastMove={activeTab === "legend-moves" ? legendLastMove : userLastMove}
                  isInteractive={false}
                  gameEndState={null}
                  fadedPieces={activeTab === "legend-moves"}
                  squareSize="responsive-md"
                />
              )}
            </div>

            {/* Promotion Popup */}
            <PromotionPopup
              isOpen={practiceGame.pendingPromotion !== null}
              color={(data.userColor || "w") as Color}
              onSelect={practiceGame.handlePromotionSelect}
            />

            {/* Navigation Controls — hidden during explanation (has own controls) */}
            {activeTab !== "explanation" && (
            <div className="flex flex-row items-center gap-2 md:gap-2 mt-2 md:mt-3 lg:mt-6 px-2 lg:px-0 justify-center">
              {/* Analysis Navigation Buttons — hidden during practice */}
              {activeTab !== "practice" && (
                <div className="flex items-center gap-1 md:gap-2 lg:gap-1">
                  <button
                    onClick={goToFirst}
                    disabled={isAtStart}
                    className={cn(
                      "w-9 h-9 sm:w-11 sm:h-11 md:w-11 md:h-11 lg:w-9 lg:h-9 flex items-center justify-center border transition-colors",
                      isAtStart
                        ? "opacity-30 cursor-not-allowed border-white/10"
                        : "border-white/20 bg-white/5 hover:bg-white/15 active:bg-white/20"
                    )}
                    title="First (Home)"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70 md:scale-110 lg:scale-100">
                      <polyline points="11 17 6 12 11 7" />
                      <polyline points="18 17 13 12 18 7" />
                    </svg>
                  </button>
                  <button
                    onClick={goBack}
                    disabled={isAtStart}
                    className={cn(
                      "w-9 h-9 sm:w-11 sm:h-11 md:w-11 md:h-11 lg:w-9 lg:h-9 flex items-center justify-center border transition-colors",
                      isAtStart
                        ? "opacity-30 cursor-not-allowed border-white/10"
                        : "border-white/20 bg-white/5 hover:bg-white/15 active:bg-white/20"
                    )}
                    title="Back (Left Arrow)"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70 md:scale-110 lg:scale-100">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <button
                    onClick={goForward}
                    disabled={isAtEnd}
                    className={cn(
                      "w-9 h-9 sm:w-11 sm:h-11 md:w-11 md:h-11 lg:w-9 lg:h-9 flex items-center justify-center border transition-colors",
                      isAtEnd
                        ? "opacity-30 cursor-not-allowed border-white/10"
                        : "border-white/20 bg-white/5 hover:bg-white/15 active:bg-white/20"
                    )}
                    title="Forward (Right Arrow)"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70 md:scale-110 lg:scale-100">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                  <button
                    onClick={goToLast}
                    disabled={isAtEnd}
                    className={cn(
                      "w-9 h-9 sm:w-11 sm:h-11 md:w-11 md:h-11 lg:w-9 lg:h-9 flex items-center justify-center border transition-colors",
                      isAtEnd
                        ? "opacity-30 cursor-not-allowed border-white/10"
                        : "border-white/20 bg-white/5 hover:bg-white/15 active:bg-white/20"
                    )}
                    title="Last (End)"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70 md:scale-110 lg:scale-100">
                      <polyline points="13 17 18 12 13 7" />
                      <polyline points="6 17 11 12 6 7" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Practice controls — shown during practice on mobile */}
              {activeTab === "practice" && (
                <div className="flex items-center gap-1 md:gap-2 lg:gap-1 lg:hidden">
                  <button
                    onClick={practiceGame.resetGame}
                    className="h-9 md:h-10 px-3 md:px-4 text-sm md:text-sm border border-amber-500/30 text-amber-400/80 bg-amber-500/5 hover:bg-amber-500/10 transition-colors"
                    style={{ fontFamily: "'Geist', sans-serif" }}
                  >
                    Reset
                  </button>
                  <button
                    onClick={handleBackToAnalysis}
                    className="h-9 md:h-10 px-3 md:px-4 text-sm md:text-sm border border-white/20 text-white/60 bg-white/5 hover:bg-white/15 transition-colors"
                    style={{ fontFamily: "'Geist', sans-serif" }}
                  >
                    Back to Analysis
                  </button>
                </div>
              )}

              {/* Separator */}
              {activeTab !== "practice" && (
                <div className="w-px h-7 md:h-8 lg:h-6 bg-white/10 mx-1 md:mx-2" />
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-1 md:gap-2 lg:gap-1">
                <button
                  onClick={currentToggleFlip}
                  className="h-9 md:h-10 lg:h-9 px-3 md:px-4 lg:px-3 text-sm md:text-sm lg:text-xs border border-white/20 text-white/60 bg-white/5 hover:bg-white/15 hover:text-white transition-colors"
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  Flip
                </button>
                <button
                  onClick={() => router.push("/play")}
                  className="h-9 md:h-10 lg:h-9 px-3 md:px-4 lg:px-3 text-sm md:text-sm lg:text-xs border border-white/20 text-white/60 bg-white/5 hover:bg-white/15 hover:text-white transition-colors"
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  Back
                </button>
              </div>
            </div>
            )}

            {/* Legend Key / Practice Status (Mobile) */}
            <div className="lg:hidden mt-2 md:mt-3 px-4 md:px-8">
              <div className="flex items-center justify-center gap-6 md:gap-10 py-2 md:py-3 border-t border-white/10">
                {activeTab === "your-moves" && (
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 bg-white/90 border border-white/40 flex items-center justify-center">
                      <span className="text-xs">♟</span>
                    </div>
                    <span
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-white/60 text-xs"
                    >
                      Your Move
                    </span>
                  </div>
                )}
                {activeTab === "legend-moves" && (
                  <div className="flex items-center gap-2">
                    <div
                      className="w-5 h-5 bg-white/30 border border-white/20 flex items-center justify-center"
                      style={{ opacity: 0.8 }}
                    >
                      <span className="text-xs">♟</span>
                    </div>
                    <span
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-white/60 text-xs"
                    >
                      Legend&apos;s Moves
                    </span>
                  </div>
                )}
                {activeTab === "practice" && (
                  <div className="flex items-center gap-2">
                    {practiceGame.isBotThinking ? (
                      <>
                        <div className="flex gap-1">
                          <div className="w-1.5 h-1.5 bg-amber-400/60 rounded-full animate-pulse" />
                          <div className="w-1.5 h-1.5 bg-amber-400/60 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
                          <div className="w-1.5 h-1.5 bg-amber-400/60 rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
                        </div>
                        <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-amber-400/60 text-xs">
                          Engine thinking...
                        </span>
                      </>
                    ) : practiceGame.gameOver ? (
                      <span
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className={cn(
                          "text-xs",
                          practiceGame.gameResult === "win" && "text-amber-400",
                          practiceGame.gameResult === "loss" && "text-white/50",
                          practiceGame.gameResult === "draw" && "text-white/60"
                        )}
                      >
                        {practiceGame.gameOverReason}{practiceGame.gameResult === "win" ? " — You win!" : practiceGame.gameResult === "draw" ? " — Draw" : ""}
                      </span>
                    ) : (
                      <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-amber-400/60 text-xs">
                        Practice vs Engine (Expert ~2200)
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right - Legend Key & Info (hidden on mobile) */}
          <div className="lg:col-span-3 order-3 hidden lg:flex lg:flex-col space-y-4">
            {/* View Mode Tabs - Desktop */}
            <div className="border border-white/10 p-4">
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-[10px] tracking-[0.3em] uppercase text-white/40 mb-3"
              >
                View Mode
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setActiveTab("explanation")}
                  className={cn(
                    "w-full px-4 py-2.5 text-xs tracking-wide border transition-colors text-left",
                    activeTab === "explanation"
                      ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                      : "border-white/10 text-white/40 hover:text-white/60 hover:border-white/20"
                  )}
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  Explanation
                </button>
                {hasLegendMoves && (
                  <button
                    onClick={() => setActiveTab("legend-moves")}
                    className={cn(
                      "w-full px-4 py-2.5 text-xs tracking-wide border transition-colors text-left",
                      activeTab === "legend-moves"
                        ? "border-sky-500/40 text-sky-400 bg-sky-500/10"
                        : "border-white/10 text-white/40 hover:text-white/60 hover:border-white/20"
                    )}
                    style={{ fontFamily: "'Geist', sans-serif" }}
                  >
                    Legend&apos;s Moves
                  </button>
                )}
                <button
                  onClick={() => setActiveTab("your-moves")}
                  className={cn(
                    "w-full px-4 py-2.5 text-xs tracking-wide border transition-colors text-left",
                    activeTab === "your-moves"
                      ? "border-white/40 text-white bg-white/10"
                      : "border-white/10 text-white/40 hover:text-white/60 hover:border-white/20"
                  )}
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  Your Moves
                </button>
                <button
                  onClick={handlePracticeTabClick}
                  className={cn(
                    "w-full px-4 py-2.5 text-xs tracking-wide border transition-colors text-left",
                    activeTab === "practice"
                      ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
                      : "border-white/10 text-white/40 hover:text-white/60 hover:border-white/20"
                  )}
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  Practice
                </button>
              </div>
            </div>

            {/* Legend Key - Legend Moves Mode */}
            {hasLegendMoves && activeTab === "legend-moves" && (
              <div className="border border-sky-500/20 p-5">
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[10px] tracking-[0.3em] uppercase text-sky-400/60 mb-4"
                >
                  Legend&apos;s Board
                </p>
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 bg-white/5 border border-white/20 flex items-center justify-center"
                    style={{ opacity: 0.8 }}
                  >
                    <span className="text-white text-lg">♟</span>
                  </div>
                  <div>
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-white/60 text-sm"
                    >
                      Legend&apos;s Pieces
                    </p>
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-white/40 text-xs"
                    >
                      Subtle fade
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Practice Info Panel */}
            {activeTab === "practice" && (
              <div className="border border-amber-500/20 p-5">
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[10px] tracking-[0.3em] uppercase text-amber-400/60 mb-4"
                >
                  Practice Mode
                </p>
                <div className="space-y-3">
                  {/* Engine info */}
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      practiceGame.isEngineReady ? "bg-amber-400" : "bg-white/30 animate-pulse"
                    )} />
                    <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/60 text-sm">
                      {practiceGame.isEngineReady ? "Stockfish Expert (~2200)" : "Loading engine..."}
                    </span>
                  </div>

                  {/* Turn indicator */}
                  <div className="flex items-center gap-2">
                    {practiceGame.isBotThinking ? (
                      <>
                        <div className="flex gap-0.5">
                          <div className="w-1.5 h-1.5 bg-amber-400/60 rounded-full animate-pulse" />
                          <div className="w-1.5 h-1.5 bg-amber-400/60 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
                          <div className="w-1.5 h-1.5 bg-amber-400/60 rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
                        </div>
                        <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-amber-400/60 text-sm">
                          Engine thinking...
                        </span>
                      </>
                    ) : practiceGame.gameOver ? (
                      <span
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className={cn(
                          "text-sm",
                          practiceGame.gameResult === "win" && "text-amber-400",
                          practiceGame.gameResult === "loss" && "text-white/50",
                          practiceGame.gameResult === "draw" && "text-white/60"
                        )}
                      >
                        {practiceGame.gameOverReason}
                      </span>
                    ) : practiceGame.isPlayerTurn ? (
                      <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/60 text-sm">
                        Your turn
                      </span>
                    ) : (
                      <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/40 text-sm">
                        Waiting...
                      </span>
                    )}
                  </div>

                  {/* Moves played */}
                  <div className="flex justify-between">
                    <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/40 text-sm">
                      Moves played
                    </span>
                    <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-white text-sm font-mono">
                      {practiceGame.moveHistory.length}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Explanation Info Panel */}
            {activeTab === "explanation" && hasExplanation && (
              <div className="border border-emerald-500/20 p-5">
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[10px] tracking-[0.3em] uppercase text-emerald-400/60 mb-3"
                >
                  Explanation
                </p>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/60 text-sm">
                      Segments
                    </span>
                    <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-white text-sm font-mono">
                      {explanationPlayer.totalSegments}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/60 text-sm">
                      Mode
                    </span>
                    <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-emerald-400 text-sm">
                      {explanationPlayer.isManualMode ? "Manual" : "Audio"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/60 text-sm">
                      Current
                    </span>
                    <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-white text-sm font-mono">
                      {explanationPlayer.currentSegmentIndex + 1} / {explanationPlayer.totalSegments}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Narration — desktop only (mobile narration lives inside ExplanationView) */}
            {activeTab === "explanation" && hasExplanation && (
              <div className="border border-white/10 bg-white/[0.02] max-h-[30vh] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-white/25">
                <NarrationDisplay
                  explanation={data.explanation as ExplanationData}
                  currentSegmentIndex={explanationPlayer.currentSegmentIndex}
                  currentTimeRef={explanationPlayer.currentTimeRef}
                  isPlaying={explanationPlayer.isPlaying}
                  isManualMode={explanationPlayer.isManualMode}
                />
              </div>
            )}

            {/* Divergence Info — hidden during practice and explanation */}
            {hasLegendMoves && activeTab !== "practice" && activeTab !== "explanation" && (
              <div className="border border-white/10 p-5">
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[10px] tracking-[0.3em] uppercase text-white/40 mb-3"
                >
                  Statistics
                </p>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-white/60 text-sm"
                    >
                      {activeTab === "legend-moves" ? "Legend Game Moves" : "Total Moves"}
                    </span>
                    <span
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-white text-sm font-mono"
                    >
                      {activeTab === "legend-moves" ? fullLegendMoves.length : maxPly}
                    </span>
                  </div>
                  {activeTab !== "legend-moves" && (
                    <>
                      <div className="flex justify-between">
                        <span
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="text-white/60 text-sm"
                        >
                          Divergent Moves
                        </span>
                        <span
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="text-amber-400 text-sm font-mono"
                        >
                          {divergences.filter((d) => d.isDivergent).length}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="text-white/60 text-sm"
                        >
                          Match Rate
                        </span>
                        <span
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="text-green-400 text-sm font-mono"
                        >
                          {maxPly > 0
                            ? Math.round(
                                ((maxPly -
                                  divergences.filter((d) => d.isDivergent).length) /
                                  maxPly) *
                                  100
                              )
                            : 0}
                          %
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default AnalysisPage;
