"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { ExplanationData } from "@/lib/hooks/useExplanationPlayer";

interface SegmentListProps {
  explanation: ExplanationData;
  currentSegmentIndex: number;
  onSegmentClick: (index: number) => void;
}

export default function SegmentList({
  explanation,
  currentSegmentIndex,
  onSegmentClick,
}: SegmentListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll to active segment
  useEffect(() => {
    if (activeRef.current && listRef.current) {
      activeRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [currentSegmentIndex]);

  return (
    <div
      ref={listRef}
      className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-white/25"
      style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}
    >
      {explanation.segments.map((segment, index) => {
        const isActive = index === currentSegmentIndex;
        // Truncate narration to ~80 chars
        const preview =
          segment.narration.length > 80
            ? segment.narration.slice(0, 80) + "..."
            : segment.narration;

        return (
          <button
            key={index}
            ref={isActive ? activeRef : undefined}
            onClick={() => onSegmentClick(index)}
            className={cn(
              "w-full text-left px-4 py-3 border-b border-white/5 transition-colors",
              isActive
                ? "bg-emerald-500/10 border-l-2 border-l-emerald-400/60"
                : "hover:bg-white/5 border-l-2 border-l-transparent"
            )}
          >
            <div className="flex items-start gap-2">
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className={cn(
                  "text-[10px] font-mono mt-0.5 shrink-0",
                  isActive ? "text-emerald-400" : "text-white/30"
                )}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className={cn(
                  "text-xs leading-relaxed line-clamp-2",
                  isActive ? "text-white/80" : "text-white/40"
                )}
              >
                {preview}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
