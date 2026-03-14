"use client";

import { useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";

interface MoveNavigationProps {
  totalMoves: number;
  viewingMoveIndex: number | null;
  onNavigate: (index: number | null) => void;
  onPlaySound?: () => void;
  disabled?: boolean;
  enableKeyboard?: boolean;
}

export default function MoveNavigation({
  totalMoves,
  viewingMoveIndex,
  onNavigate,
  onPlaySound,
  disabled = false,
  enableKeyboard = true,
}: MoveNavigationProps) {
  const isLive = viewingMoveIndex === null;
  const currentIndex = viewingMoveIndex ?? totalMoves;

  const goToFirst = useCallback(() => {
    if (!disabled && totalMoves > 0 && currentIndex !== 0) {
      onNavigate(0);
      onPlaySound?.();
    }
  }, [disabled, totalMoves, currentIndex, onNavigate, onPlaySound]);

  const goBack = useCallback(() => {
    if (!disabled) {
      if (isLive && totalMoves > 0) {
        onNavigate(totalMoves - 1);
        onPlaySound?.();
      } else if (viewingMoveIndex !== null && viewingMoveIndex > 0) {
        onNavigate(viewingMoveIndex - 1);
        onPlaySound?.();
      }
    }
  }, [disabled, isLive, totalMoves, viewingMoveIndex, onNavigate, onPlaySound]);

  const goForward = useCallback(() => {
    if (!disabled && viewingMoveIndex !== null) {
      if (viewingMoveIndex < totalMoves - 1) {
        onNavigate(viewingMoveIndex + 1);
        onPlaySound?.();
      } else {
        onNavigate(null);
        onPlaySound?.();
      }
    }
  }, [disabled, viewingMoveIndex, totalMoves, onNavigate, onPlaySound]);

  const goToLast = useCallback(() => {
    if (!disabled && totalMoves > 0) {
      onNavigate(null);
      onPlaySound?.();
    }
  }, [disabled, totalMoves, onNavigate, onPlaySound]);

  // Keyboard navigation — only one instance should handle this
  useEffect(() => {
    if (disabled || !enableKeyboard) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          goBack();
          break;
        case "ArrowRight":
          e.preventDefault();
          goForward();
          break;
        case "ArrowUp":
        case "Home":
          e.preventDefault();
          goToFirst();
          break;
        case "ArrowDown":
        case "End":
          e.preventDefault();
          goToLast();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, enableKeyboard, goBack, goForward, goToFirst, goToLast]);

  const canGoBack = totalMoves > 0 && (isLive || currentIndex > 0);
  const canGoForward = !isLive;

  return (
    <div className="flex items-center gap-1">
      {/* First */}
      <button
        onClick={goToFirst}
        disabled={disabled || !canGoBack || currentIndex === 0}
        className={cn(
          "w-9 h-9 sm:w-11 sm:h-11 flex items-center justify-center transition-all duration-200",
          "border border-cb-border-strong bg-cb-hover hover:bg-cb-surface-elevated active:bg-cb-surface-elevated",
          "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-cb-hover"
        )}
        title="First move (Home)"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-cb-text">
          <polyline points="11 17 6 12 11 7" />
          <line x1="18" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Back */}
      <button
        onClick={goBack}
        disabled={disabled || !canGoBack}
        className={cn(
          "w-9 h-9 sm:w-11 sm:h-11 flex items-center justify-center transition-all duration-200",
          "border border-cb-border-strong bg-cb-hover hover:bg-cb-surface-elevated active:bg-cb-surface-elevated",
          "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-cb-hover"
        )}
        title="Previous move (Left Arrow)"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-cb-text">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      {/* Forward */}
      <button
        onClick={goForward}
        disabled={disabled || !canGoForward}
        className={cn(
          "w-9 h-9 sm:w-11 sm:h-11 flex items-center justify-center transition-all duration-200",
          "border border-cb-border-strong bg-cb-hover hover:bg-cb-surface-elevated active:bg-cb-surface-elevated",
          "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-cb-hover"
        )}
        title="Next move (Right Arrow)"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-cb-text">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {/* Last */}
      <button
        onClick={goToLast}
        disabled={disabled || isLive || totalMoves === 0}
        className={cn(
          "w-9 h-9 sm:w-11 sm:h-11 flex items-center justify-center transition-all duration-200",
          "border border-cb-border-strong bg-cb-hover hover:bg-cb-surface-elevated active:bg-cb-surface-elevated",
          "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-cb-hover"
        )}
        title="Latest move (End)"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-cb-text">
          <polyline points="13 17 18 12 13 7" />
          <line x1="6" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </div>
  );
}
