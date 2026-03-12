"use client";

import { useEffect, useRef, useState, type RefObject, type ReactNode } from "react";
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
  hideSpeedAndVolume?: boolean;
  extraControls?: React.ReactNode;
}


const RATES = [0.5, 1, 1.5, 2];
const DISPLAY_UPDATE_MS = 250; // ~4Hz — plenty for a progress bar with CSS transitions

function formatAudioTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AudioControls({
  isPlaying,
  isManualMode,
  hasAudio,
  currentTimeRef,
  duration,
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
  hideSpeedAndVolume = false,
  extraControls,
}: AudioControlsProps) {
  const [displayTime, setDisplayTime] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

  // Sync displayTime from ref at ~4Hz when playing, or immediately on pause/seek
  useEffect(() => {
    setDisplayTime(currentTimeRef.current);
    if (!isPlaying) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setDisplayTime(currentTimeRef.current);
    }, DISPLAY_UPDATE_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, currentTimeRef, currentSegmentIndex]);

  const progress = duration > 0 ? (displayTime / duration) * 100 : 0;

  return (
    <div className="space-y-2">
      {/* Audio progress bar */}
      {hasAudio && (
        <div className="px-4">
          <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-400/60 transition-[width] duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-[10px] text-white/30 font-mono"
            >
              {formatAudioTime(displayTime)}
            </span>
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-[10px] text-white/30 font-mono"
            >
              {formatAudioTime(duration)}
            </span>
          </div>
        </div>
      )}

      {/* Controls row */}
      <div className="flex flex-wrap items-center justify-center gap-2 px-4">
        {/* Prev segment */}
        <button
          onClick={onPrevSegment}
          disabled={currentSegmentIndex === 0}
          className={cn(
            "w-8 h-8 flex items-center justify-center border transition-colors",
            currentSegmentIndex === 0
              ? "opacity-30 cursor-not-allowed border-white/10"
              : "border-white/20 bg-white/5 hover:bg-white/15"
          )}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Skip back 5s */}
        {hasAudio && (
          <button
            onClick={onSkipBack}
            className="w-8 h-8 flex items-center justify-center border border-white/20 bg-white/5 hover:bg-white/15 transition-colors relative"
            title="Rewind 5s (Left Arrow)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            <span className="absolute text-[7px] font-bold text-white/50" style={{ fontFamily: "'Geist', sans-serif", top: '10px' }}>5</span>
          </button>
        )}

        {/* Play/Pause (audio mode only) */}
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

        {/* Skip forward 5s */}
        {hasAudio && (
          <button
            onClick={onSkipForward}
            className="w-8 h-8 flex items-center justify-center border border-white/20 bg-white/5 hover:bg-white/15 transition-colors relative"
            title="Forward 5s (Right Arrow)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
              <path d="M23 4v6h-6" />
              <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
            </svg>
            <span className="absolute text-[7px] font-bold text-white/50" style={{ fontFamily: "'Geist', sans-serif", top: '10px' }}>5</span>
          </button>
        )}

        {/* Next segment */}
        <button
          onClick={onNextSegment}
          disabled={currentSegmentIndex >= totalSegments - 1}
          className={cn(
            "w-8 h-8 flex items-center justify-center border transition-colors",
            currentSegmentIndex >= totalSegments - 1
              ? "opacity-30 cursor-not-allowed border-white/10"
              : "border-white/20 bg-white/5 hover:bg-white/15"
          )}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        {/* Extra controls slot (e.g. Share button) */}
        {extraControls && (
          <>
            <div className="w-px h-6 bg-white/10 mx-1" />
            {extraControls}
          </>
        )}

        {/* Speed selector + Mute toggle — hidden when docked to bottom bar */}
        {!hideSpeedAndVolume && (
          <>
            {/* Separator */}
            {hasAudio && <div className="w-px h-6 bg-white/10 mx-1" />}

            {/* Speed selector */}
            {hasAudio && (
              <div className="flex items-center gap-1">
                {RATES.map((rate) => (
                  <button
                    key={rate}
                    onClick={() => onSetPlaybackRate(rate)}
                    className={cn(
                      "px-1.5 py-0.5 text-[10px] font-mono border transition-colors",
                      playbackRate === rate
                        ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                        : "border-white/10 text-white/30 hover:text-white/50"
                    )}
                    style={{ fontFamily: "'Geist', sans-serif" }}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            )}

            {/* Mute toggle */}
            {hasAudio && (
              <>
                <div className="w-px h-6 bg-white/10 mx-1" />
                <button
                  onClick={onToggleMute}
                  className="w-8 h-8 flex items-center justify-center border border-white/10 hover:bg-white/5 transition-colors"
                >
                  {isMuted ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19" />
                      <line x1="23" y1="9" x2="17" y2="15" />
                      <line x1="17" y1="9" x2="23" y2="15" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/50">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </svg>
                  )}
                </button>
              </>
            )}
          </>
        )}
      </div>

      {/* Speed + Volume — second row when separated from main controls */}
      {hideSpeedAndVolume && hasAudio && (
        <div className="flex items-center justify-center gap-2 px-4 mt-2">
          <div className="flex items-center gap-1">
            {RATES.map((rate) => (
              <button
                key={rate}
                onClick={() => onSetPlaybackRate(rate)}
                className={cn(
                  "px-1.5 py-0.5 text-[10px] font-mono border transition-colors",
                  playbackRate === rate
                    ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                    : "border-white/10 text-white/30 hover:text-white/50"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                {rate}x
              </button>
            ))}
          </div>
          <div className="w-px h-6 bg-white/10 mx-1" />
          <button
            onClick={onToggleMute}
            className="w-8 h-8 flex items-center justify-center border border-white/10 hover:bg-white/5 transition-colors"
          >
            {isMuted ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/50">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
          </button>
        </div>
      )}

      {/* Segment indicator */}
      <div className="flex justify-center">
        <span
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="text-[10px] text-white/25 tracking-wider"
        >
          {isManualMode ? "MANUAL" : "AUDIO"} · SEGMENT {currentSegmentIndex + 1} OF {totalSegments}
        </span>
      </div>
    </div>
  );
}
