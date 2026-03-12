"use client";

import { useState, useEffect } from "react";
import { Chess } from "chess.js";
import Link from "next/link";
import { Navbar } from "@/app/components/Navbar";
import ChessBoard from "@/app/components/ChessBoard";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";

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
      <div className="min-h-screen bg-black text-white pt-16 sm:pt-20 md:pt-24 pb-8 relative">
        {/* Subtle grid */}
        <div
          className="fixed inset-0 opacity-[0.015] pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />

        <div className="relative max-w-5xl mx-auto px-4 sm:px-8">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-8 sm:mb-12"
          >
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-12 bg-white/30" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-white/50 text-[10px] tracking-[0.4em] uppercase"
              >
                No Account Required
              </span>
              <div className="h-px w-12 bg-white/30" />
            </div>
            <h1
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-4xl sm:text-5xl md:text-6xl text-white mb-3"
            >
              Try a Position
            </h1>
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-white/40 text-base sm:text-lg max-w-lg mx-auto"
            >
              Play against the bot on iconic chess positions. No sign-up needed.
            </p>
          </motion.div>

          {/* Loading */}
          {loading && (
            <div className="flex justify-center py-20">
              <div className="w-10 h-10 border border-white/20 border-t-white/60 rounded-full animate-spin" />
            </div>
          )}

          {/* Position Grid */}
          {!loading && positions.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6"
            >
              {positions.map((pos, i) => {
                const context = pos.positionContext as Record<string, string> | null;
                const title = pos.tournamentName
                  || context?.openingName
                  || context?.gameName
                  || pos.positionType
                  || "Position";

                return (
                  <motion.div
                    key={pos.referenceId}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 * i }}
                  >
                    <Link href={`/try/${pos.referenceId}`}>
                      <div className="group border border-white/10 hover:border-white/25 transition-all duration-300 cursor-pointer">
                        {/* Board preview */}
                        <div className="p-3 sm:p-4">
                          <ChessBoard
                            board={new Chess(pos.fen).board()}
                            playerColor={pos.sideToMove === "black" ? "b" : "w"}
                            isInteractive={false}
                            showCoordinates={false}
                            squareSize="responsive-md"
                          />
                        </div>

                        {/* Info */}
                        <div className="px-4 pb-4 pt-1">
                          <h3
                            style={{ fontFamily: "'Instrument Serif', serif" }}
                            className="text-white text-lg mb-1 group-hover:text-white/90"
                          >
                            {title}
                          </h3>
                          {pos.whitePlayerName && pos.blackPlayerName && (
                            <p
                              style={{ fontFamily: "'Geist', sans-serif" }}
                              className="text-white/40 text-xs mb-2"
                            >
                              {pos.whitePlayerName} vs {pos.blackPlayerName}
                            </p>
                          )}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div
                                className={cn(
                                  "w-3 h-3 rounded-full border",
                                  pos.sideToMove === "white" || pos.sideToMove === "w"
                                    ? "bg-white border-white/40"
                                    : "bg-zinc-800 border-white/25"
                                )}
                              />
                              <span
                                style={{ fontFamily: "'Geist', sans-serif" }}
                                className="text-white/30 text-[10px] tracking-wider uppercase"
                              >
                                {pos.sideToMove === "black" || pos.sideToMove === "b" ? "Black" : "White"} to move
                              </span>
                            </div>
                            <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-white/50 group-hover:translate-x-1 transition-all" />
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
              <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/40">
                No featured positions available right now.
              </p>
            </div>
          )}

          {/* Sign up nudge */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-center mt-10 sm:mt-14"
          >
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-white/30 text-sm mb-3"
            >
              Create a free account to unlock all positions and track your progress
            </p>
            <Link href="/sign-in">
              <button
                className={cn(
                  "group relative overflow-hidden",
                  "border border-white/20 hover:border-white/40 text-white/60 hover:text-white",
                  "px-8 py-3",
                  "text-sm font-semibold tracking-[0.1em] uppercase",
                  "transition-all duration-300"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                <span className="relative flex items-center gap-3 transition-colors duration-300">
                  Sign Up Free
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </button>
            </Link>
          </motion.div>
        </div>
      </div>
    </>
  );
}
