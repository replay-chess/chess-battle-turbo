"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Chess } from "chess.js";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { motion } from "motion/react";
import { Navbar } from "@/app/components/Navbar";
import ChessBoard from "@/app/components/ChessBoard";
import { Bot } from "lucide-react";

interface PositionData {
  referenceId: string;
  fen: string;
  sideToMove: string;
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  tournamentName: string | null;
  positionType: string | null;
  positionContext: Record<string, unknown> | null;
}

export default function TryPositionPage({
  params,
}: {
  params: Promise<{ positionReferenceId: string }>;
}) {
  const router = useRouter();
  const { positionReferenceId } = use(params);

  const [position, setPosition] = useState<PositionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/chess-positions/featured")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          const found = (data.data as PositionData[]).find(
            (p) => p.referenceId === positionReferenceId
          );
          if (found) {
            setPosition(found);
          } else {
            setError("Position not found");
          }
        } else {
          setError("Failed to load position");
        }
      })
      .catch(() => setError("Failed to load position"))
      .finally(() => setLoading(false));
  }, [positionReferenceId]);

  const handlePlayVsBot = async () => {
    if (!position || creating) return;
    setCreating(true);
    try {
      const response = await fetch("/api/chess/create-demo-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chessPositionReferenceId: position.referenceId,
        }),
      });
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to create demo game");
      }

      // Store demo user ref for the game page
      sessionStorage.setItem("demoUserReferenceId", data.data.demoUserReferenceId);
      router.push(`/try/game/${data.data.gameReferenceId}`);
    } catch (err) {
      logger.error("Error creating demo game:", err);
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-black flex items-center justify-center pt-16 md:pt-24">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/40 text-sm tracking-wide">
              Loading position...
            </p>
          </div>
        </div>
      </>
    );
  }

  if (error || !position) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-black flex items-center justify-center pt-16 md:pt-24 p-4 relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-white/10 p-8 max-w-md text-center"
          >
            <h2
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-2xl text-white mb-3"
            >
              Position Not Found
            </h2>
            <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/40 mb-8">
              {error || "This position is not available for demo play."}
            </p>
            <button
              onClick={() => router.push("/try")}
              className="w-full py-4 bg-white text-black transition-all duration-300"
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              Browse Positions
            </button>
          </motion.div>
        </div>
      </>
    );
  }

  const context = position.positionContext as Record<string, string> | null;
  const title = position.tournamentName
    || context?.openingName
    || context?.gameName
    || "Featured Position";
  const boardOrientation =
    position.sideToMove === "black" || position.sideToMove === "b" ? "b" : "w";

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-black flex flex-col lg:flex-row pt-16 sm:pt-18 md:pt-24 relative overflow-hidden">
        {/* Diagonal gradient */}
        <div
          className="absolute inset-0 opacity-60"
          style={{
            background: `linear-gradient(135deg,
              rgba(255,255,255,0.03) 0%,
              transparent 40%,
              transparent 60%,
              rgba(255,255,255,0.02) 100%
            )`,
          }}
        />

        {/* Left Side — Details */}
        <div className="flex-1 flex items-center justify-center pt-4 sm:pt-2 lg:pt-6 px-6 sm:px-8 lg:px-12 pb-28 lg:pb-0 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-md"
          >
            {/* Label */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="flex items-center gap-3 mb-4 lg:mb-6"
            >
              <div className="h-px flex-1 bg-gradient-to-r from-white/30 to-transparent" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-white/50 text-[10px] tracking-[0.4em] uppercase"
              >
                Demo — No Sign-up Required
              </span>
              <div className="h-px flex-1 bg-gradient-to-l from-white/30 to-transparent" />
            </motion.div>

            {/* Position metadata */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="mb-6 lg:mb-8"
            >
              <h1
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-3xl sm:text-4xl text-white mb-2"
              >
                {position.whitePlayerName && position.blackPlayerName ? (
                  <>
                    {position.whitePlayerName}
                    <span className="text-white/30 mx-2 text-2xl">vs</span>
                    {position.blackPlayerName}
                  </>
                ) : (
                  title
                )}
              </h1>
              {position.tournamentName && position.whitePlayerName && (
                <div className="flex items-center gap-3 mt-3">
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent to-white/30" />
                  <span
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-white/50 text-[10px] tracking-[0.4em] uppercase"
                  >
                    {position.tournamentName}
                  </span>
                  <div className="h-px flex-1 bg-gradient-to-l from-transparent to-white/30" />
                </div>
              )}
            </motion.div>

            {/* Mobile-only board */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="lg:hidden mb-6 flex justify-center"
            >
              <div className="w-full max-w-sm">
                <ChessBoard
                  board={new Chess(position.fen).board()}
                  playerColor={boardOrientation}
                  isInteractive={false}
                  showCoordinates={true}
                  squareSize="responsive-md"
                />
              </div>
            </motion.div>

            {/* Side to move + Time info */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="flex items-center justify-between mb-6"
            >
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "w-3.5 h-3.5 rounded-full border",
                    boardOrientation === "w"
                      ? "bg-white border-white/40"
                      : "bg-zinc-800 border-white/25"
                  )}
                />
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-white/50 text-xs tracking-wider uppercase"
                >
                  {boardOrientation === "w" ? "White" : "Black"} to move
                </span>
              </div>
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-white/30 text-xs tracking-wider uppercase"
              >
                5+3 Blitz
              </span>
            </motion.div>

            {/* CTA button — sticky on mobile */}
            <div className="fixed bottom-0 left-0 right-0 z-50 p-3 bg-black/90 backdrop-blur-sm border-t border-white/[0.06] lg:static lg:bg-transparent lg:p-0 lg:border-0 lg:backdrop-blur-none">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <button
                  onClick={handlePlayVsBot}
                  disabled={creating}
                  className={cn(
                    "group relative w-full flex items-center justify-center gap-2 px-5 py-3.5",
                    "bg-white text-black",
                    "transition-all duration-300 overflow-hidden",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  <span className="absolute inset-0 bg-black origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                  <Bot className="relative z-10 w-4 h-4 group-hover:text-white transition-colors flex-shrink-0" strokeWidth={1.5} />
                  <span className="relative z-10 text-sm font-medium group-hover:text-white transition-colors duration-300">
                    {creating ? "Starting..." : "Play vs Bot"}
                  </span>
                </button>
              </motion.div>
            </div>
          </motion.div>
        </div>

        {/* Right Side — Chess Board (desktop only) */}
        <div className="hidden lg:flex flex-1 items-center justify-center p-8 relative">
          <div className="absolute top-0 right-0 w-96 h-96 bg-white/[0.02] rounded-full blur-3xl" />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.6, duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-xl relative"
          >
            <div className="m-8">
              <ChessBoard
                board={new Chess(position.fen).board()}
                playerColor={boardOrientation}
                isInteractive={false}
                showCoordinates={true}
              />
            </div>
          </motion.div>
        </div>

        {/* Decorative corner elements */}
        <div className="absolute top-20 left-6 w-16 h-16 border-l border-t border-white/10" />
        <div className="absolute bottom-6 right-6 w-16 h-16 border-r border-b border-white/10" />
      </div>
    </>
  );
}
