"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import { Difficulty, DIFFICULTY_OPTIONS } from "@/lib/hooks/useBotMove";

type DifficultySelectorProps = {
  value: Difficulty;
  onChange: (value: Difficulty) => void;
};

export default function DifficultySelector({
  value,
  onChange,
}: DifficultySelectorProps) {
  return (
    <div className="w-full">
      <label
        style={{ fontFamily: "'Geist', sans-serif" }}
        className="block text-xs text-cb-text-muted uppercase tracking-widest mb-4"
      >
        Bot Difficulty
      </label>
      <div className="grid grid-cols-2 gap-3">
        {DIFFICULTY_OPTIONS.map((option, index) => (
          <motion.button
            key={option.value}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "group relative flex flex-col items-center justify-center p-5 border transition-all duration-300 overflow-hidden",
              value === option.value
                ? "bg-cb-accent text-cb-accent-fg border-cb-accent"
                : "bg-transparent text-cb-text-secondary border-cb-border hover:border-cb-border-strong"
            )}
          >
            {/* Hover fill effect for unselected */}
            {value !== option.value && (
              <span className="absolute inset-0 bg-cb-accent origin-bottom scale-y-0 group-hover:scale-y-100 transition-transform duration-300" />
            )}

            <span
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className={cn(
                "relative z-10 text-xl transition-colors duration-300",
                value === option.value
                  ? "text-cb-accent-fg"
                  : "text-cb-text group-hover:text-cb-accent-fg"
              )}
            >
              {option.label}
            </span>

            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className={cn(
                "relative z-10 text-xs mt-1 transition-colors duration-300",
                value === option.value
                  ? "text-cb-accent-fg/50"
                  : "text-cb-text-muted group-hover:text-cb-accent-fg/50"
              )}
            >
              ~{option.elo} ELO
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
