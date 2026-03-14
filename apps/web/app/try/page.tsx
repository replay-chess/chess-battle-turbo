"use client";

import { useState, useEffect } from "react";
import { Chess } from "chess.js";
import Link from "next/link";
import { Navbar } from "@/app/components/Navbar";
import ChessBoard from "@/app/components/ChessBoard";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import { ArrowRight, Crown } from "lucide-react";
import { ThemeToggle } from "@/app/components/ThemeToggle";

interface FeaturedPosition {
  referenceId: string;
  fen: string;
  sideToMove: string;
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  tournamentName: string | null;
  positionType: string | null;
  positionContext: Record<string, unknown> | null;
}

export default function TryPage() {
  const [positions, setPositions] = useState<FeaturedPosition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/chess-positions/featured")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setPositions(data.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-cb-bg text-cb-text pt-16 sm:pt-20 md:pt-24 pb-12 relative">
        {/* Ambient background glow */}
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 60% 40% at 50% 0%, var(--cb-hover) 0%, transparent 70%)",
          }}
        />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-8">
          {/* Theme Toggle */}
          <div className="flex justify-end mb-4">
            <div className="w-48">
              <ThemeToggle />
            </div>
          </div>

          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-10 sm:mb-14"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="inline-flex items-center gap-2 border border-cb-border bg-cb-hover px-4 py-1.5 mb-6"
            >
              <Crown className="w-3 h-3 text-cb-text-muted" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-secondary text-[10px] tracking-[0.3em] uppercase"
              >
                No Account Required
              </span>
            </motion.div>
            <h1
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-4xl sm:text-5xl md:text-6xl text-cb-text mb-4"
            >
              Play Legendary Positions
            </h1>
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted text-base sm:text-lg max-w-md mx-auto leading-relaxed"
            >
              Step into iconic moments from chess history.
              Challenge the bot — no sign-up needed.
            </p>
          </motion.div>

          {/* Loading */}
          {loading && (
            <div className="flex justify-center py-20">
              <div className="w-10 h-10 border border-cb-border-strong border-t-cb-text-secondary rounded-full animate-spin" />
            </div>
          )}

          {/* Position Grid */}
          {!loading && positions.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6"
            >
              {positions.map((pos, i) => {
                const context = pos.positionContext as Record<string, string> | null;
                const title = pos.tournamentName
                  || context?.openingName
                  || context?.gameName
                  || pos.positionType
                  || "Position";
                const isBlack = pos.sideToMove === "black" || pos.sideToMove === "b";

                return (
                  <motion.div
                    key={pos.referenceId}
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08 * i, duration: 0.5 }}
                  >
                    <Link href={`/try/${pos.referenceId}`}>
                      <div
                        className={cn(
                          "group relative bg-cb-surface border border-cb-border",
                          "hover:border-cb-border-strong transition-all duration-500",
                          "hover:bg-cb-hover"
                        )}
                      >
                        {/* Board preview */}
                        <div className="p-4 pt-6 sm:p-6 sm:pt-8">
                          <ChessBoard
                            board={new Chess(pos.fen).board()}
                            playerColor={isBlack ? "b" : "w"}
                            isInteractive={false}
                            showCoordinates={false}
                            squareSize="md"
                          />
                        </div>

                        {/* Info section */}
                        <div className="relative px-4 sm:px-6 pb-4 sm:pb-6 pt-0">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3
                                style={{ fontFamily: "'Instrument Serif', serif" }}
                                className="text-cb-text text-lg leading-tight mb-1 truncate group-hover:text-cb-text-secondary transition-colors"
                              >
                                {title}
                              </h3>
                              {pos.whitePlayerName && pos.blackPlayerName && (
                                <p
                                  style={{ fontFamily: "'Geist', sans-serif" }}
                                  className="text-cb-text-muted text-xs truncate"
                                >
                                  {pos.whitePlayerName} vs {pos.blackPlayerName}
                                </p>
                              )}
                            </div>
                            <div
                              className={cn(
                                "shrink-0 mt-1 flex items-center justify-center",
                                "w-8 h-8 border transition-all duration-500",
                                "border-cb-border group-hover:border-cb-border-strong",
                                "group-hover:bg-cb-hover"
                              )}
                            >
                              <ArrowRight className="w-3.5 h-3.5 text-cb-text-faint group-hover:text-cb-text-secondary group-hover:translate-x-0.5 transition-all duration-300" />
                            </div>
                          </div>

                          {/* Side to move badge */}
                          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-cb-border">
                            <div
                              className={cn(
                                "w-2.5 h-2.5 rounded-full",
                                isBlack
                                  ? "bg-zinc-700 ring-1 ring-white/10"
                                  : "bg-white/90 ring-1 ring-white/20"
                              )}
                            />
                            <span
                              style={{ fontFamily: "'Geist', sans-serif" }}
                              className="text-cb-text-faint text-[10px] tracking-[0.15em] uppercase"
                            >
                              {isBlack ? "Black" : "White"} to move
                            </span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </motion.div>
          )}

          {/* Empty state */}
          {!loading && positions.length === 0 && (
            <div className="text-center py-20">
              <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-cb-text-muted">
                No featured positions available right now.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
