"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { cn } from "@/lib/utils";
import type { ExplanationData } from "@/lib/hooks/useExplanationPlayer";

interface WordTiming {
  word: string;
  start: number;
  end: number;
}

interface NarrationDisplayProps {
  explanation: ExplanationData;
  currentSegmentIndex: number;
  currentTimeRef: RefObject<number>;
  isPlaying: boolean;
  isManualMode: boolean;
}

// Single line height (text-sm leading-relaxed ≈ 24px)
const LINE_HEIGHT = 24;

export default function NarrationDisplay({
  explanation,
  currentSegmentIndex,
  currentTimeRef,
  isPlaying,
  isManualMode,
}: NarrationDisplayProps) {
  const activeWordRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const [animatedTime, setAnimatedTime] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const rafRef = useRef<number>(0);
  const measureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPlaying || isManualMode) {
      setAnimatedTime(currentTimeRef.current);
      return;
    }
    const tick = () => {
      setAnimatedTime(currentTimeRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, isManualMode, currentTimeRef]);

  // Reset on segment change
  useEffect(() => {
    setIsExpanded(false);
    if (textRef.current) textRef.current.scrollTop = 0;
  }, [currentSegmentIndex]);

  // Measure overflow
  useEffect(() => {
    if (measureRef.current) {
      setOverflows(measureRef.current.scrollHeight > LINE_HEIGHT);
    }
  }, [currentSegmentIndex]);

  // Auto-scroll so active word's line is visible when collapsed
  useEffect(() => {
    if (isExpanded || !activeWordRef.current || !textRef.current) return;
    const wordEl = activeWordRef.current;
    const container = textRef.current;
    // Get the word's offset relative to the text container
    const wordTop = wordEl.offsetTop - container.offsetTop;
    // Scroll so that the word's line is the visible line
    const targetScroll = Math.max(0, wordTop);
    if (Math.abs(container.scrollTop - targetScroll) > 2) {
      container.scrollTo({ top: targetScroll, behavior: "smooth" });
    }
  }, [animatedTime, isExpanded]);

  const segment = explanation.segments[currentSegmentIndex];
  if (!segment) return null;

  const containerStyle = isExpanded
    ? { fontFamily: "'Geist', sans-serif" }
    : { fontFamily: "'Geist', sans-serif", maxHeight: `${LINE_HEIGHT}px`, overflow: "hidden" as const };

  // Manual mode — plain text
  if (!explanation.alignment || isManualMode) {
    return (
      <div className="px-4 py-3 relative">
        <div ref={measureRef} className="absolute inset-x-0 px-4 invisible" aria-hidden>
          <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-sm leading-relaxed">
            {segment.narration}
          </p>
        </div>
        <p
          ref={textRef}
          style={containerStyle}
          className="text-white/80 text-sm leading-relaxed"
        >
          {segment.narration}
        </p>
        {overflows && (
          <button
            onClick={() => setIsExpanded((v) => !v)}
            className="mt-1.5 text-[10px] text-white/30 hover:text-white/50 transition-colors tracking-wider uppercase"
            style={{ fontFamily: "'Geist', sans-serif" }}
          >
            {isExpanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    );
  }

  // Karaoke mode
  const alignment = explanation.alignment;
  const allWords: WordTiming[] = alignment.words.map((word, i) => ({
    word,
    start: alignment.startTimes[i] ?? 0,
    end: alignment.endTimes[i] ?? 0,
  }));

  const segmentWords = allWords.filter(
    (w) => w.start >= segment.startTime && w.start < segment.endTime
  );

  const time = animatedTime;

  return (
    <div className="px-4 py-3 relative">
      <div ref={measureRef} className="absolute inset-x-0 px-4 invisible" aria-hidden>
        <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-sm leading-relaxed">
          {segmentWords.map((w) => w.word).join(" ")}
        </p>
      </div>
      <p
        ref={textRef}
        style={containerStyle}
        className="text-sm leading-relaxed"
      >
        {segmentWords.map((w, i) => {
          const isActive = time >= w.start && time < w.end;
          return (
            <span
              key={`${currentSegmentIndex}-${i}`}
              ref={isActive ? activeWordRef : undefined}
              className={cn(
                "transition-colors duration-150",
                time >= w.end && "text-white/90",
                isActive && "text-emerald-400",
                time < w.start && "text-white/25"
              )}
              style={
                isActive
                  ? { textShadow: "0 0 8px rgba(52, 211, 153, 0.4)" }
                  : undefined
              }
            >
              {w.word}{" "}
            </span>
          );
        })}
      </p>
      {overflows && (
        <button
          onClick={() => setIsExpanded((v) => !v)}
          className="mt-1.5 text-[10px] text-white/30 hover:text-white/50 transition-colors tracking-wider uppercase"
          style={{ fontFamily: "'Geist', sans-serif" }}
        >
          {isExpanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
