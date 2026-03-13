"use client";

import ChessBoard from "../../components/ChessBoard";
import AudioControls from "./AudioControls";
import NarrationDisplay from "./NarrationDisplay";
import EvalBar from "./EvalBar";
import type { ExplanationData } from "@/lib/hooks/useExplanationPlayer";
import type { useExplanationPlayer } from "@/lib/hooks/useExplanationPlayer";
import { Color } from "chess.js";

interface ExplanationViewProps {
  explanation: ExplanationData;
  player: ReturnType<typeof useExplanationPlayer>;
  playerColor: Color;
  onShare?: () => void;
}

/** Board + narration + controls only — segment list lives in page's left panel */
export default function ExplanationView({
  explanation,
  player,
  playerColor,
  onShare,
}: ExplanationViewProps) {
  return (
    <div className="flex flex-col items-center w-full">
      {/* Board + optional eval bar */}
      <div className="w-full flex gap-2">
        {player.evalBar && (
          <EvalBar
            score={player.evalBar.score}
            description={player.evalBar.description}
            flipped={playerColor === "b"}
          />
        )}
        <div className="flex-1">
          <ChessBoard
            board={player.board}
            playerColor={playerColor}
            showCoordinates={true}
            isInteractive={false}
            highlights={player.highlights}
            arrows={player.arrows}
            annotations={player.annotations}
            lastMove={player.lastMove}
            animatingMove={player.animatingMove}
            squareSize="responsive-md"
          />
        </div>
      </div>
      <p className="text-[10px] text-white/50 uppercase tracking-wider text-center mt-0.5">
        {playerColor === "b" ? "Black" : "White"}
      </p>

      {/* Audio/navigation controls — lg:mt-7 clears the board's decorative frame on desktop */}
      <div className="w-full mt-2 lg:mt-7">
        <AudioControls
          isPlaying={player.isPlaying}
          isManualMode={player.isManualMode}
          hasAudio={player.hasAudio}
          currentTimeRef={player.currentTimeRef}
          duration={player.duration}
          isMuted={player.isMuted}
          playbackRate={player.playbackRate}
          currentSegmentIndex={player.currentSegmentIndex}
          totalSegments={player.totalSegments}
          onTogglePlayPause={player.togglePlayPause}
          onNextSegment={player.nextSegment}
          onPrevSegment={player.prevSegment}
          onToggleMute={player.toggleMute}
          onSetPlaybackRate={player.setPlaybackRate}
          onSeekToSegment={player.seekToSegment}
          onSkipBack={player.skipBack}
          onSkipForward={player.skipForward}
          extraControls={onShare ? (
            <button
              onClick={onShare}
              className="group relative overflow-hidden h-10 px-6 bg-white text-black transition-all duration-300"
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              <span className="absolute inset-0 bg-black origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300 ease-out" />
              <span className="relative z-10 flex items-center gap-2 text-xs font-semibold tracking-[0.1em] group-hover:text-white transition-colors duration-300">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:text-white transition-colors">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                SHARE
              </span>
            </button>
          ) : undefined}
        />
      </div>

    </div>
  );
}

/** Empty state shown when no explanation data exists */
export function ExplanationComingSoon() {
  return (
    <div className="flex flex-col items-center justify-center py-12 lg:py-20 gap-4">
      <div className="w-16 h-16 border border-white/10 flex items-center justify-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/20">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      </div>
      <div className="text-center space-y-2">
        <p
          style={{ fontFamily: "'Instrument Serif', serif" }}
          className="text-white/40 text-lg"
        >
          Position explanation coming soon
        </p>
        <p
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="text-white/20 text-xs max-w-xs mx-auto leading-relaxed"
        >
          A grandmaster-style breakdown of this position&apos;s key ideas, visualized with highlights and arrows on the board.
        </p>
      </div>
    </div>
  );
}
