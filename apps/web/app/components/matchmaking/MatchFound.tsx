"use client";

import React from "react";
import { motion } from "motion/react";
import { Swords } from "lucide-react";
import { getInitials } from "@/lib/utils";

interface MatchFoundProps {
  opponentName: string;
  opponentProfilePictureUrl?: string | null;
}

export function MatchFound({
  opponentName,
  opponentProfilePictureUrl,
}: MatchFoundProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center min-h-[400px] space-y-8"
    >
      {/* Match found animation */}
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", duration: 0.5 }}
        className="relative"
      >
        {/* Success ring */}
        <motion.div
          className="absolute inset-0 border border-cb-border-strong"
          initial={{ scale: 1, opacity: 1 }}
          animate={{ scale: 1.5, opacity: 0 }}
          transition={{ duration: 1, repeat: 2 }}
          style={{ width: 100, height: 100 }}
        />

        {/* Center icon */}
        <div className="relative w-[100px] h-[100px] bg-cb-accent flex items-center justify-center">
          <motion.div
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <Swords className="w-10 h-10 text-cb-accent-fg" strokeWidth={1.5} />
          </motion.div>
        </div>
      </motion.div>

      {/* Match found text */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="text-center space-y-2"
      >
        <h2
          style={{ fontFamily: "'Instrument Serif', serif" }}
          className="text-3xl text-cb-text"
        >
          Match Found
        </h2>
        <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-cb-text-muted">
          Get ready to play
        </p>
      </motion.div>

      {/* Opponent info */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="flex items-center gap-4 p-5 border border-cb-border"
      >
        {/* Opponent avatar */}
        {opponentProfilePictureUrl ? (
          <img
            src={opponentProfilePictureUrl}
            alt={opponentName}
            className="w-12 h-12 object-cover grayscale"
          />
        ) : (
          <div className="w-12 h-12 bg-cb-accent flex items-center justify-center">
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-sm font-bold text-cb-accent-fg"
            >
              {getInitials(opponentName)}
            </span>
          </div>
        )}

        <div>
          <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-xs text-cb-text-muted uppercase tracking-widest">
            Your opponent
          </p>
          <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-lg font-medium text-cb-text">
            {opponentName}
          </p>
        </div>
      </motion.div>

      {/* Loading indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="flex items-center gap-2 text-cb-text-muted"
      >
        <div className="w-4 h-4 border border-cb-border-strong border-t-cb-text rounded-full animate-spin" />
        <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-sm">
          Starting game...
        </span>
      </motion.div>
    </motion.div>
  );
}
