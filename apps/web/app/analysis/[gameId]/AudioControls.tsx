"use client";

import type { RefObject } from "react";
import { cn } from "@/lib/utils";

interface AudioControlsProps {
  isPlaying: boolean;
  isManualMode: boolean;
  hasAudio: boolean;
  currentTimeRef: RefObject<number>;
  duration: number;
  isMuted: boolean;
  playbackRate: number;
  currentSegmentIndex: number;
  totalSegments: number;
  onTogglePlayPause: () => void;
  onNextSegment: () => void;
  onPrevSegment: () => void;
  onToggleMute: () => void;
  onSetPlaybackRate: (rate: number) => void;
  onSeekToSegment: (index: number) => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  extraControls?: React.ReactNode;
}


const RATES = [0.5, 1, 1.5, 2];

export default function AudioControls({
  isPlaying,
  hasAudio,
  isMuted,
  playbackRate,
  currentSegmentIndex,
  totalSegments,
  onTogglePlayPause,
  onNextSegment,
  onPrevSegment,
  onToggleMute,
  onSetPlaybackRate,
  onSkipBack,
  onSkipForward,
  extraControls,
}: AudioControlsProps) {
  return (
    <div className="space-y-2">
      {/* Desktop-only: bigger share button */}
      {extraControls && (
        <div className="hidden lg:flex justify-center px-4">
          {extraControls}
        </div>
      )}

      {/* Mobile/tablet: nav + share row */}
      <div className="flex flex-wrap md:flex-nowrap items-center justify-center gap-2 px-4 lg:hidden">
        {/* Navigation buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onPrevSegment}
            disabled={currentSegmentIndex === 0}
            className={cn(
              "w-8 h-8 flex items-center justify-center border transition-colors",
              currentSegmentIndex === 0
                ? "opacity-30 cursor-not-allowed border-cb-border"
                : "border-cb-border-strong bg-cb-hover hover:bg-cb-surface-elevated"
            )}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cb-text-secondary">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          {hasAudio && (
            <button
              onClick={onSkipBack}
              className="w-8 h-8 flex items-center justify-center border border-cb-border-strong bg-cb-hover hover:bg-cb-surface-elevated transition-colors relative"
              title="Rewind 5s (Left Arrow)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cb-text-secondary">
                <path d="M1 4v6h6" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              <span className="absolute text-[7px] font-bold text-cb-text-secondary" style={{ fontFamily: "'Geist', sans-serif", top: '10px' }}>5</span>
            </button>
          )}

          {hasAudio && (
            <button
              onClick={onTogglePlayPause}
              className="w-10 h-10 flex items-center justify-center border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors"
            >
              {isPlaying ? (
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
          )}

          {hasAudio && (
            <button
              onClick={onSkipForward}
              className="w-8 h-8 flex items-center justify-center border border-cb-border-strong bg-cb-hover hover:bg-cb-surface-elevated transition-colors relative"
              title="Forward 5s (Right Arrow)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cb-text-secondary">
                <path d="M23 4v6h-6" />
                <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
              </svg>
              <span className="absolute text-[7px] font-bold text-cb-text-secondary" style={{ fontFamily: "'Geist', sans-serif", top: '10px' }}>5</span>
            </button>
          )}

          <button
            onClick={onNextSegment}
            disabled={currentSegmentIndex >= totalSegments - 1}
            className={cn(
              "w-8 h-8 flex items-center justify-center border transition-colors",
              currentSegmentIndex >= totalSegments - 1
                ? "opacity-30 cursor-not-allowed border-cb-border"
                : "border-cb-border-strong bg-cb-hover hover:bg-cb-surface-elevated"
            )}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cb-text-secondary">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {/* Share button — mobile/tablet only (desktop has it above) */}
        {extraControls}

        {/* Speed + Mute — tablet only (mobile has row 2, desktop has right column) */}
        {hasAudio && (
          <div className="hidden md:flex lg:hidden items-center gap-2">
            <div className="flex items-center gap-1">
              {RATES.map((rate) => (
                <button
                  key={rate}
                  onClick={() => onSetPlaybackRate(rate)}
                  className={cn(
                    "px-1.5 py-0.5 text-[10px] font-mono border transition-colors",
                    playbackRate === rate
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
              onClick={onToggleMute}
              className="w-8 h-8 flex items-center justify-center border border-cb-border hover:bg-cb-hover transition-colors"
            >
              {isMuted ? (
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
      </div>

      {/* Row 2: Speed + Mute — mobile only */}
      {hasAudio && (
        <div className="flex items-center justify-center gap-2 px-4 md:hidden">
          <div className="flex items-center gap-1">
            {RATES.map((rate) => (
              <button
                key={rate}
                onClick={() => onSetPlaybackRate(rate)}
                className={cn(
                  "px-1.5 py-0.5 text-[10px] font-mono border transition-colors",
                  playbackRate === rate
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
            onClick={onToggleMute}
            className="w-8 h-8 flex items-center justify-center border border-cb-border hover:bg-cb-hover transition-colors"
          >
            {isMuted ? (
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

    </div>
  );
}
