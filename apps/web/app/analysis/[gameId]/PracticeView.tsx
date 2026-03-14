"use client";

import { useState } from "react";
import { Color } from "chess.js";
import ChessBoard from "../../components/ChessBoard";
import { PromotionPopup } from "../../components/PromotionPopup";
import PracticeMoveList from "./PracticeMoveList";
import EngineConfigSliders from "./EngineConfigSliders";
import MultiPvDisplay from "./MultiPvDisplay";
import { usePlayFromPosition } from "@/lib/hooks/usePlayFromPosition";
import { useMultiPvAnalysis } from "@/lib/hooks/useMultiPvAnalysis";
import { cn } from "@/lib/utils";

type AnalysisTab = "explanation" | "your-moves" | "legend-moves";

interface PracticeViewProps {
  startingFen: string | null;
  playerColor: Color;
  resetKey: number;
  onBackToAnalysis: () => void;
  onShare: () => void;
  onTabChange: (tab: AnalysisTab) => void;
  onPracticeTabClick: () => void;
  hasLegendMoves: boolean;
}

export default function PracticeView({
  startingFen,
  playerColor,
  resetKey,
  onBackToAnalysis,
  onShare,
  onTabChange,
  onPracticeTabClick,
  hasLegendMoves,
}: PracticeViewProps) {
  const [skillLevel, setSkillLevel] = useState(20);
  const [depth, setDepth] = useState(12);
  const [searchTimeSec, setSearchTimeSec] = useState(0);
  const [multiPvCount, setMultiPvCount] = useState(0);

  const practiceGame = usePlayFromPosition({
    startingFen,
    playerColor,
    resetKey,
    skillLevel,
    depth,
    searchTimeMs: searchTimeSec > 0 ? searchTimeSec * 1000 : undefined,
    disableBot: multiPvCount > 0,
  });

  const multiPvAnalysis = useMultiPvAnalysis({
    fen: startingFen ? practiceGame.currentFen : null,
    multiPvCount,
    analysisDepth: depth,
    analyzePosition: practiceGame.analyzePosition,
    stopAnalysis: practiceGame.stopAnalysis,
    isEngineReady: practiceGame.isEngineReady,
  });

  const practiceFenSide = startingFen?.split(" ")[1] === "b" ? "b" : "w";

  return (
    <>
      {/* Left column - desktop PracticeMoveList */}
      <div className="lg:col-span-3 order-2 lg:order-1 hidden lg:flex lg:flex-col">
        <div className="border border-amber-500/20 flex flex-col max-h-[70vh] overflow-hidden">
          <PracticeMoveList
            moveHistory={practiceGame.moveHistory}
            isBotThinking={practiceGame.isBotThinking}
            gameOver={practiceGame.gameOver}
            gameOverReason={practiceGame.gameOverReason}
            gameResult={practiceGame.gameResult}
            onReset={practiceGame.resetGame}
            onBackToAnalysis={onBackToAnalysis}
            playerColor={playerColor}
            startingSide={practiceFenSide as "w" | "b"}
            skillLevel={skillLevel}
            depth={depth}
          />
        </div>

        {/* Action Buttons — desktop only (below move list) */}
        <div className="flex items-center justify-center gap-2 mt-3">
          <button
            onClick={onShare}
            className="group relative overflow-hidden h-10 px-5 bg-cb-accent text-cb-accent-fg transition-all duration-300"
            style={{ fontFamily: "'Geist', sans-serif" }}
          >
            <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300 ease-out" />
            <span className="relative z-10 flex items-center gap-2 text-xs font-semibold tracking-[0.1em] group-hover:text-cb-text transition-colors duration-300">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:text-cb-text transition-colors">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              SHARE
            </span>
          </button>
          <button
            onClick={practiceGame.toggleFlip}
            className="group relative overflow-hidden h-10 px-5 border border-cb-border-strong bg-cb-hover text-cb-text-secondary hover:bg-cb-surface-elevated hover:text-cb-text transition-all duration-300"
            style={{ fontFamily: "'Geist', sans-serif" }}
          >
                        <span className="relative z-10 flex items-center gap-2 text-xs font-semibold tracking-[0.1em] group-hover:text-cb-text transition-colors duration-300">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:text-cb-text transition-colors">
                <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
              FLIP
            </span>
          </button>
        </div>
      </div>

      {/* Center column - board + controls */}
      <div className="lg:col-span-6 order-1 lg:order-2 flex flex-col lg:block">
        {/* Board */}
        <div className="mx-1 sm:p-5 md:p-5 lg:p-0 lg:mt-1 lg:mb-4 lg:mx-0">
          <p className="text-[10px] text-cb-text-secondary uppercase tracking-wider text-center mb-0.5">
            {practiceGame.isFlipped ? "White" : "Black"}
          </p>
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
            arrows={multiPvAnalysis.arrows}
          />
          <p className="text-[10px] text-cb-text-secondary uppercase tracking-wider text-center mt-0.5">
            {practiceGame.isFlipped ? "Black" : "White"}
          </p>
        </div>

        {/* Promotion Popup */}
        <PromotionPopup
          isOpen={practiceGame.pendingPromotion !== null}
          color={playerColor}
          onSelect={practiceGame.handlePromotionSelect}
        />

        {/* Controls */}
        <div className="flex flex-row items-center gap-2 md:gap-3 mt-2 md:mt-4 lg:mt-6 px-2 lg:px-0 justify-center">
          {/* Practice controls — mobile */}
          <div className="flex items-center gap-1 md:gap-2 lg:gap-1 lg:hidden">
            <button
              onClick={practiceGame.resetGame}
              className="h-9 md:h-11 px-3 md:px-5 text-sm md:text-base border border-amber-500/30 text-amber-400/80 bg-amber-500/5 hover:bg-amber-500/10 transition-colors"
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              Reset
            </button>
            <button
              onClick={onBackToAnalysis}
              className="h-9 md:h-11 px-3 md:px-5 text-sm md:text-base border border-cb-border-strong text-cb-text-secondary bg-cb-hover hover:bg-cb-surface-elevated transition-colors"
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              Back to Analysis
            </button>
          </div>

          {/* Action Buttons — mobile/tablet only (desktop has them in left column) */}
          <div className="flex items-center gap-2 lg:hidden">
            <button
              onClick={onShare}
              className="group relative overflow-hidden h-9 md:h-11 px-4 md:px-6 bg-cb-accent text-cb-accent-fg transition-all duration-300"
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300 ease-out" />
              <span className="relative z-10 flex items-center gap-2 text-xs md:text-sm font-semibold tracking-[0.1em] group-hover:text-cb-text transition-colors duration-300">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:text-cb-text transition-colors">
                  <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                SHARE
              </span>
            </button>
            <button
              onClick={practiceGame.toggleFlip}
              className="group relative overflow-hidden h-9 md:h-11 px-4 md:px-6 border border-cb-border-strong bg-cb-hover text-cb-text-secondary hover:bg-cb-surface-elevated hover:text-cb-text transition-all duration-300"
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
                            <span className="relative z-10 flex items-center gap-2 text-xs md:text-sm font-semibold tracking-[0.1em] group-hover:text-cb-text transition-colors duration-300">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:text-cb-text transition-colors">
                  <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
                FLIP
              </span>
            </button>
          </div>
        </div>

        {/* Mobile status + sliders */}
        <div className="lg:hidden mt-2 md:mt-3 px-4 md:px-8">
          <div className="flex items-center justify-center gap-6 md:gap-10 py-2 md:py-3 border-t border-cb-border">
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
                    practiceGame.gameResult === "loss" && "text-cb-text-secondary",
                    practiceGame.gameResult === "draw" && "text-cb-text-secondary"
                  )}
                >
                  {practiceGame.gameOverReason}{practiceGame.gameResult === "win" ? " — You win!" : practiceGame.gameResult === "draw" ? " — Draw" : ""}
                </span>
              ) : (
                <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-amber-400/60 text-xs">
                  Practice vs Stockfish (~{600 + skillLevel * 80} ELO)
                </span>
              )}
            </div>
          </div>
          {!practiceGame.gameOver && (
            <EngineConfigSliders
              skillLevel={skillLevel}
              depth={depth}
              searchTimeSec={searchTimeSec}
              onSkillLevelChange={setSkillLevel}
              onDepthChange={setDepth}
              onSearchTimeChange={setSearchTimeSec}
              multiPvCount={multiPvCount}
              onMultiPvCountChange={setMultiPvCount}
              compact
            />
          )}
          {multiPvCount > 0 && multiPvAnalysis.lines.length > 0 && (
            <div className="px-3 py-2">
              <MultiPvDisplay
                lines={multiPvAnalysis.lines}
                currentDepth={multiPvAnalysis.currentDepth}
                playerColor={playerColor}
              />
            </div>
          )}
        </div>
      </div>

      {/* Right column - desktop */}
      <div className="lg:col-span-3 order-3 hidden lg:flex lg:flex-col space-y-4">
        {/* View Mode Tabs */}
        <div className="border border-cb-border p-4">
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-3"
          >
            View Mode
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => onTabChange("explanation")}
              className="w-full px-4 py-2.5 text-xs tracking-wide border transition-colors text-left border-cb-border text-cb-text-muted hover:text-cb-text-secondary hover:border-cb-border-strong"
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              Explanation
            </button>
            {hasLegendMoves && (
              <button
                onClick={() => onTabChange("legend-moves")}
                className="w-full px-4 py-2.5 text-xs tracking-wide border transition-colors text-left border-cb-border text-cb-text-muted hover:text-cb-text-secondary hover:border-cb-border-strong"
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                Legend&apos;s Moves
              </button>
            )}
            <button
              onClick={() => onTabChange("your-moves")}
              className="w-full px-4 py-2.5 text-xs tracking-wide border transition-colors text-left border-cb-border text-cb-text-muted hover:text-cb-text-secondary hover:border-cb-border-strong"
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              Your Moves
            </button>
            <button
              onClick={onPracticeTabClick}
              className="w-full px-4 py-2.5 text-xs tracking-wide border transition-colors text-left border-amber-500/40 text-amber-400 bg-amber-500/10"
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              Practice
            </button>
          </div>
        </div>

        {/* Practice Info Panel */}
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
                practiceGame.isEngineReady ? "bg-amber-400" : "bg-cb-text-muted animate-pulse"
              )} />
              <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-cb-text-secondary text-sm">
                {practiceGame.isEngineReady ? `Stockfish (~${600 + skillLevel * 80} ELO)` : "Loading engine..."}
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
                    practiceGame.gameResult === "loss" && "text-cb-text-secondary",
                    practiceGame.gameResult === "draw" && "text-cb-text-secondary"
                  )}
                >
                  {practiceGame.gameOverReason}
                </span>
              ) : practiceGame.isPlayerTurn ? (
                <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-cb-text-secondary text-sm">
                  Your turn
                </span>
              ) : (
                <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-cb-text-muted text-sm">
                  Waiting...
                </span>
              )}
            </div>

            {/* Moves played */}
            <div className="flex justify-between">
              <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-cb-text-muted text-sm">
                Moves played
              </span>
              <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-cb-text text-sm font-mono">
                {practiceGame.moveHistory.length}
              </span>
            </div>

            {/* Engine config sliders */}
            <div className="pt-2 border-t border-cb-border">
              <EngineConfigSliders
                skillLevel={skillLevel}
                depth={depth}
                searchTimeSec={searchTimeSec}
                onSkillLevelChange={setSkillLevel}
                onDepthChange={setDepth}
                onSearchTimeChange={setSearchTimeSec}
                multiPvCount={multiPvCount}
                onMultiPvCountChange={setMultiPvCount}
              />
            </div>

            {/* MultiPV evaluation display */}
            {multiPvCount > 0 && multiPvAnalysis.lines.length > 0 && (
              <div className="pt-2 border-t border-cb-border">
                <MultiPvDisplay
                  lines={multiPvAnalysis.lines}
                  currentDepth={multiPvAnalysis.currentDepth}
                  playerColor={playerColor}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
