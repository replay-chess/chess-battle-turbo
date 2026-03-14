"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Chess, Move, Color } from "chess.js";
import { useRouter } from "next/navigation";
import ChessBoard from "../../components/ChessBoard";
import AnalysisMoveList from "../../components/AnalysisMoveList";
import { Navbar } from "../../components/Navbar";
import PracticeView from "./PracticeView";
import ExplanationView, { ExplanationComingSoon } from "./ExplanationView";
import NarrationDisplay from "./NarrationDisplay";
import SegmentList from "./SegmentList";
import { AnalysisShareModal } from "./AnalysisShareModal";
import { TwitterShareBanner } from "./TwitterShareBanner";
import { useAnalysisBoard } from "@/lib/hooks/useAnalysisBoard";
import { useExplanationPlayer } from "@/lib/hooks/useExplanationPlayer";
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
  chessPositionReferenceId: string | null;
  openingReferenceId: string | null;
}

interface AnalysisPageContentProps {
  gameId: string;
  userReferenceId?: string;
  isDemo?: boolean;
}

export function AnalysisPageContent({ gameId, userReferenceId, isDemo = false }: AnalysisPageContentProps) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalysisData | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  // Fetch analysis data
  useEffect(() => {
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
  }, [gameId, userReferenceId]);

  // Tab state — default depends on whether explanation data exists
  const [activeTab, setActiveTab] = useState<AnalysisTab>("legend-moves");
  const [practiceFen, setPracticeFen] = useState<string | null>(null);
  const [practiceKey, setPracticeKey] = useState(0);
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

  // Navigation helpers — demo mode goes to /try instead of /play
  const backPath = isDemo ? "/try" : "/play";

  if (loading) {
    return (
      <div className="min-h-screen bg-cb-bg flex items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="w-10 h-10 border border-cb-border-strong border-t-cb-text-secondary rounded-full animate-spin mb-6" />
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-cb-text-muted text-xs tracking-[0.2em] uppercase"
          >
            Loading Analysis
          </p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-cb-bg flex items-center justify-center">
        <div className="text-center">
          <p
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="text-cb-text text-xl mb-4"
          >
            {error || "Analysis data not found"}
          </p>
          <button
            onClick={() => router.push(backPath)}
            className="px-6 py-2 border border-cb-border-strong text-cb-text-secondary hover:border-cb-text-muted hover:text-cb-text transition-colors"
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

  const headerContent = (
    <div className="flex flex-col items-center gap-0.5">
      {/* Line 1: Opening name OR Tournament + Players */}
      <div className="flex items-center justify-center gap-1.5 lg:gap-2 flex-wrap">
        {isOpeningGame ? (
          <div className="flex items-center gap-2">
            {data.openingEco && (
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-[10px] tracking-wider text-cb-text-secondary bg-cb-surface-elevated px-1.5 py-0.5 uppercase"
              >
                {data.openingEco}
              </span>
            )}
            <span
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-cb-text-secondary text-sm md:text-base italic"
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
                  className="text-cb-text-faint text-[10px] lg:text-xs"
                >
                  {data.tournamentName}
                </span>
                {(data.whitePlayerName || data.blackPlayerName) && (
                  <span className="text-cb-text-faint">&middot;</span>
                )}
              </>
            )}
            {(data.whitePlayerName || data.blackPlayerName) && (
              <div className="flex items-center gap-1.5 lg:gap-2">
                <span
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-sky-300/60 text-sm md:text-base"
                >
                  {data.whitePlayerName || "White"}
                </span>
                {data.legendGameResult && (
                  <span
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sky-400/70 text-xs lg:text-sm font-medium"
                  >
                    {data.legendGameResult === "white_won" && "1\u20130"}
                    {data.legendGameResult === "black_won" && "0\u20131"}
                    {data.legendGameResult === "draw" && "\u00BD\u2013\u00BD"}
                  </span>
                )}
                {!data.legendGameResult && (
                  <span className="text-cb-text-faint text-xs">vs</span>
                )}
                <span
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-sky-300/60 text-sm md:text-base"
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
              className="text-cb-text-muted text-[10px] lg:text-xs uppercase tracking-wider"
            >
              You
            </span>
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className={cn(
                "text-xs lg:text-sm font-medium px-1.5 py-0.5",
                data.userGameOutcome === "win" && "text-amber-400 bg-amber-400/10",
                data.userGameOutcome === "loss" && "text-cb-text-secondary bg-cb-hover",
                data.userGameOutcome === "draw" && "text-cb-text-secondary bg-cb-hover"
              )}
            >
              {data.userGameOutcome === "win" && "Won"}
              {data.userGameOutcome === "loss" && "Lost"}
              {data.userGameOutcome === "draw" && "Drew"}
            </span>
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted text-[10px] lg:text-xs"
            >
              as {data.userColor === "w" ? "White" : "Black"}
            </span>
          </div>
        )}
        {data.userGameOutcome && !isOpeningGame && (
          <span className="text-cb-text-faint">&middot;</span>
        )}
        {!isOpeningGame && (
          <span
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-cb-text-muted text-[10px] lg:text-xs"
          >
            from move {data.moveNumberStart}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-cb-bg text-cb-text overflow-auto">
      {/* Navbar */}
      <Navbar />

      {/* Subtle grid background */}
      <div
        className="fixed inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative max-w-7xl mx-auto px-0 sm:px-8 md:px-8 lg:px-4 pb-4 md:pb-6 lg:pb-8 pt-20 sm:pt-24 md:pt-28 lg:pt-[108px] min-h-[100dvh] flex flex-col justify-center lg:justify-start">
        {/* Mobile tabs — above grid (lg:hidden so doesn't affect desktop column alignment) */}
        <div className="flex items-center justify-center gap-2 md:gap-3 mb-1.5 sm:mb-1.5 md:mb-2 px-2 lg:hidden">
          <button
            onClick={() => setActiveTab("explanation")}
            className={cn(
              "px-3 md:px-5 py-2 md:py-2.5 text-xs md:text-sm tracking-wide border transition-colors",
              activeTab === "explanation"
                ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                : "border-cb-border text-cb-text-muted hover:text-cb-text-secondary hover:border-cb-border-strong"
            )}
            style={{ fontFamily: "'Geist', sans-serif" }}
          >
            Explain
          </button>
          {hasLegendMoves && (
            <button
              onClick={() => setActiveTab("legend-moves")}
              className={cn(
                "px-3 md:px-5 py-2 md:py-2.5 text-xs md:text-sm tracking-wide border transition-colors",
                activeTab === "legend-moves"
                  ? "border-sky-500/40 text-sky-400 bg-sky-500/10"
                  : "border-cb-border text-cb-text-muted hover:text-cb-text-secondary hover:border-cb-border-strong"
              )}
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              Legend&apos;s Moves
            </button>
          )}
          <button
            onClick={() => setActiveTab("your-moves")}
            className={cn(
              "px-3 md:px-5 py-2 md:py-2.5 text-xs md:text-sm tracking-wide border transition-colors",
              activeTab === "your-moves"
                ? "border-cb-border-strong text-cb-text bg-cb-surface-elevated"
                : "border-cb-border text-cb-text-muted hover:text-cb-text-secondary hover:border-cb-border-strong"
            )}
            style={{ fontFamily: "'Geist', sans-serif" }}
          >
            Your Moves
          </button>
          <button
            onClick={handlePracticeTabClick}
            className={cn(
              "px-3 md:px-5 py-2 md:py-2.5 text-xs md:text-sm tracking-wide border transition-colors",
              activeTab === "practice"
                ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
                : "border-cb-border text-cb-text-muted hover:text-cb-text-secondary hover:border-cb-border-strong"
            )}
            style={{ fontFamily: "'Geist', sans-serif" }}
          >
            Practice
          </button>
        </div>

        {/* Header — above grid only during practice (on analysis, it's inside center column) */}
        {activeTab === "practice" && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-1 lg:mb-1 px-2"
          >
            {headerContent}
          </motion.div>
        )}

        {/* Grid */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col lg:grid lg:grid-cols-12 gap-0 lg:gap-8 min-h-0"
        >
          {activeTab === "practice" ? (
            <PracticeView
              startingFen={practiceFen}
              playerColor={(data.userColor || "w") as Color}
              resetKey={practiceKey}
              onBackToAnalysis={handleBackToAnalysis}
              onShare={() => setShareModalOpen(true)}
              onGoBack={() => router.push(backPath)}
              onTabChange={(tab) => setActiveTab(tab)}
              onPracticeTabClick={handlePracticeTabClick}
              hasLegendMoves={hasLegendMoves}
            />
          ) : (
            <>
              {/* Left - Move List / Segment List (hidden on mobile) */}
              <div className="lg:col-span-3 order-2 lg:order-1 hidden lg:flex lg:flex-col">
                <div className={cn(
                  "border flex flex-col max-h-[70vh] overflow-hidden",
                  activeTab === "explanation" ? "border-emerald-500/20" : "border-cb-border"
                )}>
                  {activeTab === "explanation" ? (
                    hasExplanation ? (
                      <>
                        <div className="p-3 border-b border-cb-border">
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
                          className="text-cb-text-muted text-sm text-center"
                        >
                          No explanation available
                        </p>
                      </div>
                    )
                  ) : (
                    <>
                      <div className="p-4 border-b border-cb-border">
                        <p
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted"
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
                            className="text-cb-text-muted text-sm text-center"
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

                {/* Audio Nav Controls — desktop only (below segments) */}
                {activeTab === "explanation" && hasExplanation && explanationPlayer.hasAudio && (
                  <div className="flex items-center justify-center gap-2 mt-3 p-3 border border-emerald-500/20">
                    <button
                      onClick={explanationPlayer.prevSegment}
                      disabled={explanationPlayer.currentSegmentIndex === 0}
                      className={cn(
                        "w-8 h-8 flex items-center justify-center border transition-colors",
                        explanationPlayer.currentSegmentIndex === 0
                          ? "opacity-30 cursor-not-allowed border-cb-border"
                          : "border-cb-border-strong bg-cb-hover hover:bg-cb-surface-elevated"
                      )}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cb-text-secondary">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    <button
                      onClick={explanationPlayer.skipBack}
                      className="w-8 h-8 flex items-center justify-center border border-cb-border-strong bg-cb-hover hover:bg-cb-surface-elevated transition-colors relative"
                      title="Rewind 5s"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cb-text-secondary">
                        <path d="M1 4v6h6" />
                        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                      </svg>
                      <span className="absolute text-[7px] font-bold text-cb-text-secondary" style={{ fontFamily: "'Geist', sans-serif", top: '10px' }}>5</span>
                    </button>
                    <button
                      onClick={explanationPlayer.togglePlayPause}
                      className="w-10 h-10 flex items-center justify-center border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors"
                    >
                      {explanationPlayer.isPlaying ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-emerald-400">
                          <rect x="6" y="4" width="4" height="16" />
                          <rect x="14" y="4" width="4" height="16" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-emerald-400">
                          <polygon points="5 3 19 12 5 21" />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={explanationPlayer.skipForward}
                      className="w-8 h-8 flex items-center justify-center border border-cb-border-strong bg-cb-hover hover:bg-cb-surface-elevated transition-colors relative"
                      title="Forward 5s"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cb-text-secondary">
                        <path d="M23 4v6h-6" />
                        <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
                      </svg>
                      <span className="absolute text-[7px] font-bold text-cb-text-secondary" style={{ fontFamily: "'Geist', sans-serif", top: '10px' }}>5</span>
                    </button>
                    <button
                      onClick={explanationPlayer.nextSegment}
                      disabled={explanationPlayer.currentSegmentIndex >= explanationPlayer.totalSegments - 1}
                      className={cn(
                        "w-8 h-8 flex items-center justify-center border transition-colors",
                        explanationPlayer.currentSegmentIndex >= explanationPlayer.totalSegments - 1
                          ? "opacity-30 cursor-not-allowed border-cb-border"
                          : "border-cb-border-strong bg-cb-hover hover:bg-cb-surface-elevated"
                      )}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cb-text-secondary">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>

              {/* Center - Chess Board */}
              <div className="lg:col-span-6 order-1 lg:order-2 flex flex-col lg:block">
                {/* Header — inside center column so side columns align with it */}
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="mb-1 lg:mb-1 px-2"
                >
                  {headerContent}
                </motion.div>

                {/* Board */}
                <div className="mx-1 sm:p-5 md:p-5 lg:p-0 lg:mt-1 lg:mb-4 lg:mx-0">
                  <p className="text-[10px] text-cb-text-secondary uppercase tracking-wider text-center mb-0.5">
                    {(activeTab === "explanation" ? data?.userColor === "b" : isFlipped) ? "White" : "Black"}
                  </p>
                  {activeTab === "explanation" ? (
                    hasExplanation ? (
                      <ExplanationView
                        explanation={data.explanation as ExplanationData}
                        player={explanationPlayer}
                        playerColor={(data.userColor || "w") as Color}
                        onShare={() => setShareModalOpen(true)}
                      />
                    ) : (
                      <ExplanationComingSoon />
                    )
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
                  {activeTab !== "explanation" && (
                    <p className="text-[10px] text-cb-text-secondary uppercase tracking-wider text-center mt-0.5">
                      {isFlipped ? "Black" : "White"}
                    </p>
                  )}
                </div>

                {/* Navigation Controls — hidden during explanation (has own controls) */}
                {activeTab !== "explanation" && (
                <div className="flex flex-row items-center gap-2 md:gap-3 mt-1 md:mt-2 lg:mt-3 px-2 lg:px-0 justify-center">
                  {/* Analysis Navigation Buttons */}
                  <div className="flex items-center gap-1 md:gap-2 lg:gap-1">
                    <button
                      onClick={goToFirst}
                      disabled={isAtStart}
                      className={cn(
                        "w-9 h-9 sm:w-11 sm:h-11 md:w-12 md:h-12 lg:w-9 lg:h-9 flex items-center justify-center border transition-colors",
                        isAtStart
                          ? "opacity-30 cursor-not-allowed border-cb-border"
                          : "border-cb-border-strong bg-cb-hover hover:bg-cb-surface-elevated active:bg-cb-surface-elevated"
                      )}
                      title="First (Home)"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cb-text-secondary md:scale-110 lg:scale-100">
                        <polyline points="11 17 6 12 11 7" />
                        <polyline points="18 17 13 12 18 7" />
                      </svg>
                    </button>
                    <button
                      onClick={goBack}
                      disabled={isAtStart}
                      className={cn(
                        "w-9 h-9 sm:w-11 sm:h-11 md:w-12 md:h-12 lg:w-9 lg:h-9 flex items-center justify-center border transition-colors",
                        isAtStart
                          ? "opacity-30 cursor-not-allowed border-cb-border"
                          : "border-cb-border-strong bg-cb-hover hover:bg-cb-surface-elevated active:bg-cb-surface-elevated"
                      )}
                      title="Back (Left Arrow)"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cb-text-secondary md:scale-110 lg:scale-100">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    <button
                      onClick={goForward}
                      disabled={isAtEnd}
                      className={cn(
                        "w-9 h-9 sm:w-11 sm:h-11 md:w-12 md:h-12 lg:w-9 lg:h-9 flex items-center justify-center border transition-colors",
                        isAtEnd
                          ? "opacity-30 cursor-not-allowed border-cb-border"
                          : "border-cb-border-strong bg-cb-hover hover:bg-cb-surface-elevated active:bg-cb-surface-elevated"
                      )}
                      title="Forward (Right Arrow)"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cb-text-secondary md:scale-110 lg:scale-100">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                    <button
                      onClick={goToLast}
                      disabled={isAtEnd}
                      className={cn(
                        "w-9 h-9 sm:w-11 sm:h-11 md:w-12 md:h-12 lg:w-9 lg:h-9 flex items-center justify-center border transition-colors",
                        isAtEnd
                          ? "opacity-30 cursor-not-allowed border-cb-border"
                          : "border-cb-border-strong bg-cb-hover hover:bg-cb-surface-elevated active:bg-cb-surface-elevated"
                      )}
                      title="Last (End)"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cb-text-secondary md:scale-110 lg:scale-100">
                        <polyline points="13 17 18 12 13 7" />
                        <polyline points="6 17 11 12 6 7" />
                      </svg>
                    </button>
                  </div>

                  {/* Separator */}
                  <div className="w-px h-7 md:h-8 lg:h-6 bg-cb-border mx-1 md:mx-2" />

                  {/* Action Buttons */}
                  <div className="flex items-center gap-1 md:gap-2 lg:gap-1">
                    <button
                      onClick={() => setShareModalOpen(true)}
                      className="h-9 md:h-11 lg:h-9 px-3 md:px-5 lg:px-3 text-sm md:text-base lg:text-xs border border-cb-border-strong text-cb-text-secondary bg-cb-hover hover:bg-cb-surface-elevated hover:text-cb-text transition-colors"
                      style={{ fontFamily: "'Geist', sans-serif" }}
                    >
                      Share
                    </button>
                    <button
                      onClick={toggleFlip}
                      className="h-9 md:h-11 lg:h-9 px-3 md:px-5 lg:px-3 text-sm md:text-base lg:text-xs border border-cb-border-strong text-cb-text-secondary bg-cb-hover hover:bg-cb-surface-elevated hover:text-cb-text transition-colors"
                      style={{ fontFamily: "'Geist', sans-serif" }}
                    >
                      Flip
                    </button>
                    <button
                      onClick={() => router.push(backPath)}
                      className="h-9 md:h-11 lg:h-9 px-3 md:px-5 lg:px-3 text-sm md:text-base lg:text-xs border border-cb-border-strong text-cb-text-secondary bg-cb-hover hover:bg-cb-surface-elevated hover:text-cb-text transition-colors"
                      style={{ fontFamily: "'Geist', sans-serif" }}
                    >
                      Back
                    </button>
                  </div>
                </div>
                )}

                {/* Legend Key (Mobile) */}
                <div className="lg:hidden mt-2 md:mt-3 px-4 md:px-8">
                  <div className="flex items-center justify-center gap-6 md:gap-10 py-2 md:py-3 border-t border-cb-border">
                    {activeTab === "your-moves" && (
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 bg-cb-text/90 border border-cb-text-muted flex items-center justify-center">
                          <span className="text-xs">&#9823;</span>
                        </div>
                        <span
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="text-cb-text-secondary text-xs"
                        >
                          Your Move
                        </span>
                      </div>
                    )}
                    {activeTab === "legend-moves" && (
                      <div className="flex items-center gap-2">
                        <div
                          className="w-5 h-5 bg-cb-text-muted border border-cb-border-strong flex items-center justify-center"
                          style={{ opacity: 0.8 }}
                        >
                          <span className="text-xs">&#9823;</span>
                        </div>
                        <span
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="text-cb-text-secondary text-xs"
                        >
                          Legend&apos;s Moves
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right - Legend Key & Info (hidden on mobile) */}
              <div className="lg:col-span-3 order-3 hidden lg:flex lg:flex-col space-y-4">
                {/* View Mode Tabs - Desktop */}
                <div className="border border-cb-border p-4">
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-3"
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
                          : "border-cb-border text-cb-text-muted hover:text-cb-text-secondary hover:border-cb-border-strong"
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
                            : "border-cb-border text-cb-text-muted hover:text-cb-text-secondary hover:border-cb-border-strong"
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
                          ? "border-cb-border-strong text-cb-text bg-cb-surface-elevated"
                          : "border-cb-border text-cb-text-muted hover:text-cb-text-secondary hover:border-cb-border-strong"
                      )}
                      style={{ fontFamily: "'Geist', sans-serif" }}
                    >
                      Your Moves
                    </button>
                    <button
                      onClick={handlePracticeTabClick}
                      className={cn(
                        "w-full px-4 py-2.5 text-xs tracking-wide border transition-colors text-left",
                        "border-cb-border text-cb-text-muted hover:text-cb-text-secondary hover:border-cb-border-strong"
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
                        className="w-8 h-8 bg-cb-hover border border-cb-border-strong flex items-center justify-center"
                        style={{ opacity: 0.8 }}
                      >
                        <span className="text-cb-text text-lg">&#9823;</span>
                      </div>
                      <div>
                        <p
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="text-cb-text-secondary text-sm"
                        >
                          Legend&apos;s Pieces
                        </p>
                        <p
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="text-cb-text-muted text-xs"
                        >
                          Subtle fade
                        </p>
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
                        <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-cb-text-secondary text-sm">
                          Segments
                        </span>
                        <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-cb-text text-sm font-mono">
                          {explanationPlayer.totalSegments}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-cb-text-secondary text-sm">
                          Mode
                        </span>
                        <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-emerald-400 text-sm">
                          {explanationPlayer.isManualMode ? "Manual" : "Audio"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-cb-text-secondary text-sm">
                          Current
                        </span>
                        <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-cb-text text-sm font-mono">
                          {explanationPlayer.currentSegmentIndex + 1} / {explanationPlayer.totalSegments}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Narration — desktop only (mobile narration lives inside ExplanationView) */}
                {activeTab === "explanation" && hasExplanation && (
                  <div className="border border-cb-border bg-cb-hover/50 max-h-[30vh] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-cb-text-faint [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-cb-text-faint">
                    <NarrationDisplay
                      explanation={data.explanation as ExplanationData}
                      currentSegmentIndex={explanationPlayer.currentSegmentIndex}
                      currentTimeRef={explanationPlayer.currentTimeRef}
                      isPlaying={explanationPlayer.isPlaying}
                      isManualMode={explanationPlayer.isManualMode}
                    />
                  </div>
                )}

                {/* Speed + Mute Controls — desktop only (below transcript) */}
                {activeTab === "explanation" && hasExplanation && explanationPlayer.hasAudio && (
                  <div className="flex items-center justify-center gap-2 p-3 border border-cb-border">
                    <div className="flex items-center gap-1">
                      {[0.5, 1, 1.5, 2].map((rate) => (
                        <button
                          key={rate}
                          onClick={() => explanationPlayer.setPlaybackRate(rate)}
                          className={cn(
                            "px-1.5 py-0.5 text-[10px] font-mono border transition-colors",
                            explanationPlayer.playbackRate === rate
                              ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                              : "border-cb-border text-cb-text-muted hover:text-cb-text-secondary"
                          )}
                          style={{ fontFamily: "'Geist', sans-serif" }}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>
                    <div className="w-px h-6 bg-cb-border mx-1" />
                    <button
                      onClick={explanationPlayer.toggleMute}
                      className="w-8 h-8 flex items-center justify-center border border-cb-border hover:bg-cb-hover transition-colors"
                    >
                      {explanationPlayer.isMuted ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cb-text-muted">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19" />
                          <line x1="23" y1="9" x2="17" y2="15" />
                          <line x1="17" y1="9" x2="23" y2="15" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cb-text-secondary">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19" />
                          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                      )}
                    </button>
                  </div>
                )}

                {/* Divergence Info */}
                {hasLegendMoves && activeTab !== "explanation" && (
                  <div className="border border-cb-border p-5">
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-3"
                    >
                      Statistics
                    </p>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="text-cb-text-secondary text-sm"
                        >
                          {activeTab === "legend-moves" ? "Legend Game Moves" : "Total Moves"}
                        </span>
                        <span
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="text-cb-text text-sm font-mono"
                        >
                          {activeTab === "legend-moves" ? fullLegendMoves.length : maxPly}
                        </span>
                      </div>
                      {activeTab !== "legend-moves" && (
                        <>
                          <div className="flex justify-between">
                            <span
                              style={{ fontFamily: "'Geist', sans-serif" }}
                              className="text-cb-text-secondary text-sm"
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
                              className="text-cb-text-secondary text-sm"
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
            </>
          )}
        </motion.div>
      </div>

      {data && userReferenceId && (
        <AnalysisShareModal
          isOpen={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
          gameReferenceId={data.gameReferenceId}
          chessPositionReferenceId={data.chessPositionReferenceId}
          openingReferenceId={data.openingReferenceId}
          userReferenceId={userReferenceId}
        />
      )}

      {data && !isDemo && (
        <TwitterShareBanner
          whitePlayerName={data.whitePlayerName}
          blackPlayerName={data.blackPlayerName}
          tournamentName={data.tournamentName}
          openingName={data.openingName}
          chessPositionReferenceId={data.chessPositionReferenceId}
          openingReferenceId={data.openingReferenceId}
          isDemo={isDemo}
        />
      )}
    </div>
  );
}
