"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Bot, RefreshCw, ArrowLeft, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface NoOpponentPopupProps {
  isOpen: boolean;
  onPlayBot: () => void;
  onRetry: () => void;
  onBack: () => void;
  isCreatingBotGame: boolean;
  isRetrying: boolean;
  timeControl: { time: number; increment: number };
  legendName?: string | null;
}

export function NoOpponentPopup({
  isOpen,
  onPlayBot,
  onRetry,
  onBack,
  isCreatingBotGame,
  isRetrying,
  legendName,
}: NoOpponentPopupProps) {
  const isDisabled = isCreatingBotGame || isRetrying;
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-49 flex items-center justify-center bg-cb-backdrop backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="w-full max-w-md mx-4 bg-cb-bg border border-cb-border p-8 sm:p-10"
          >
            {/* Bot icon with pulse animation */}
            <div className="flex justify-center mb-8">
              <div className="relative">
                {/* Outer pulsing ring */}
                <motion.div
                  className="absolute inset-0 border border-cb-border-strong"
                  animate={{
                    scale: [1, 1.3, 1],
                    opacity: [0.4, 0, 0.4],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                  style={{ width: 80, height: 80 }}
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
                  style={{ width: 80, height: 80 }}
                />

                {/* Center icon */}
                <div className="relative w-20 h-20 border border-cb-border-strong flex items-center justify-center">
                  <Bot className="w-8 h-8 text-cb-text-secondary" strokeWidth={1.5} />
                </div>
              </div>
            </div>

            {/* Heading */}
            <div className="text-center mb-8">
              <h2
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-2xl sm:text-3xl text-cb-text mb-3"
              >
                No Opponents Available
              </h2>
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-muted text-sm leading-relaxed"
              >
                {legendName
                  ? `The battlefield is quiet. Challenge our AI using positions from ${legendName}'s famous games.`
                  : "The battlefield is quiet. Challenge our AI instead and test your skills against the machine."}
              </p>
            </div>

            {/* Action buttons */}
            <div className="space-y-3">
              {/* Primary: Play Against Bot */}
              <button
                onClick={onPlayBot}
                disabled={isDisabled}
                className={cn(
                  "group relative w-full flex items-center justify-center gap-3 px-6 py-4",
                  "bg-cb-accent text-cb-accent-fg",
                  "transition-all duration-300",
                  "disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                {/* Hover effect */}
                <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                <Bot
                  className={cn(
                    "w-5 h-5 relative z-10 group-hover:text-cb-text transition-colors",
                    isCreatingBotGame && "animate-pulse"
                  )}
                  strokeWidth={1.5}
                />
                <span className="relative z-10 group-hover:text-cb-text transition-colors font-medium">
                  {isCreatingBotGame ? "Creating Game..." : "Play Against Bot"}
                </span>
                {!isCreatingBotGame && (
                  <ArrowRight
                    className="w-4 h-4 relative z-10 group-hover:text-cb-text transition-colors ml-auto"
                    strokeWidth={1.5}
                  />
                )}
                {isCreatingBotGame && (
                  <div className="w-4 h-4 border-2 border-cb-accent-fg/30 border-t-cb-accent-fg rounded-full animate-spin relative z-10 group-hover:border-cb-text/30 group-hover:border-t-cb-text ml-auto" />
                )}
              </button>

              {/* Secondary: Try Again */}
              <button
                onClick={onRetry}
                disabled={isDisabled}
                className={cn(
                  "group relative w-full flex items-center justify-center gap-3 px-6 py-4",
                  "border border-cb-border-strong hover:border-cb-text-muted",
                  "text-cb-text-secondary hover:text-cb-text transition-all duration-300",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                <RefreshCw
                  className={cn(
                    "w-5 h-5",
                    isRetrying && "animate-spin"
                  )}
                  strokeWidth={1.5}
                />
                <span className="font-medium">
                  {isRetrying ? "Searching..." : "Try Again"}
                </span>
              </button>
            </div>

            {/* Back link */}
            <div className="mt-6 text-center">
              <button
                onClick={onBack}
                disabled={isDisabled}
                className={cn(
                  "inline-flex items-center gap-2 text-cb-text-muted hover:text-cb-text-secondary transition-colors",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
                <span className="text-sm">Back to Play</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
