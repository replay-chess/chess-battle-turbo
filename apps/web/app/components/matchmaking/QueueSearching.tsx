"use client";

import React from "react";
import { cn, formatTime } from "@/lib/utils";
import { Search, Clock, X } from "lucide-react";
import { motion } from "motion/react";

interface QueueSearchingProps {
  timeRemaining: number;
  onCancel: () => void;
  isLoading?: boolean;
  isCancelling?: boolean;
  timeControlLabel?: string;
}

export function QueueSearching({
  timeRemaining,
  onCancel,
  isLoading = false,
  isCancelling = false,
  timeControlLabel = "5 min",
}: QueueSearchingProps) {
  return (
    <motion.div
      data-testid="queue-searching"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center min-h-[400px] space-y-8"
    >
      {/* Animated searching indicator */}
      <div className="relative">
        {/* Outer pulsing ring */}
        <motion.div
          className="absolute inset-0 border border-cb-border-strong"
          animate={{
            scale: [1, 1.3, 1],
            opacity: [0.5, 0, 0.5],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          style={{ width: 100, height: 100 }}
        />

        {/* Second ring */}
        <motion.div
          className="absolute inset-0 border border-cb-border"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0, 0.3],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 0.5,
          }}
          style={{ width: 100, height: 100 }}
        />

        {/* Center icon */}
        <div className="relative w-[100px] h-[100px] border border-cb-border-strong flex items-center justify-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: "linear",
            }}
          >
            <Search className="w-8 h-8 text-cb-text-secondary" strokeWidth={1.5} />
          </motion.div>
        </div>
      </div>

      {/* Status text */}
      <div className="text-center space-y-2">
        <h2
          style={{ fontFamily: "'Instrument Serif', serif" }}
          className="text-2xl text-cb-text"
        >
          Finding Opponent
        </h2>
        <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-cb-text-muted">
          Looking for a {timeControlLabel} match
        </p>
      </div>

      {/* Time remaining */}
      <div className="flex items-center gap-3 px-4 py-2 border border-cb-border">
        <Clock className="w-4 h-4 text-cb-text-muted" strokeWidth={1.5} />
        <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-lg font-mono text-cb-text">
          {formatTime(timeRemaining)}
        </span>
      </div>

      {/* Cancel button */}
      <button
        onClick={onCancel}
        disabled={isLoading || isCancelling}
        className={cn(
          "group flex items-center gap-2 px-6 py-3",
          "border border-cb-border hover:border-cb-border-strong hover:bg-cb-accent hover:text-cb-accent-fg",
          "text-cb-text-secondary hover:text-cb-accent-fg transition-all duration-300",
          "disabled:cursor-not-allowed"
        )}
        style={{ fontFamily: "'Geist', sans-serif" }}
      >
        {isCancelling ? (
          <div className="w-4 h-4 border-2 border-cb-border-strong border-t-cb-text-secondary group-hover:border-cb-accent-fg/20 group-hover:border-t-cb-accent-fg rounded-full animate-spin transition-colors duration-300" />
        ) : (
          <X className="w-4 h-4" strokeWidth={1.5} />
        )}
        <span>{isCancelling ? "Cancelling..." : "Cancel Search"}</span>
      </button>

      {/* Tips */}
      <div className="max-w-sm text-center">
        <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-xs text-cb-text-muted">
          Matching players with similar ratings for fair games
        </p>
      </div>
    </motion.div>
  );
}
