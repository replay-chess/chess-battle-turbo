"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Chess } from "chess.js";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { motion, AnimatePresence } from "motion/react";
import { Navbar } from "@/app/components/Navbar";
import ChessBoard from "@/app/components/ChessBoard";
import { Bot, Users, Zap, Lock, Crown, Sparkles, BarChart3 } from "lucide-react";
import { SignInButton } from "@clerk/nextjs";

const lockedModes = [
  { id: "friend" as const, title: "Challenge Friend", subtitle: "Share a private invitation", icon: Users },
  { id: "quick" as const, title: "Quick Match", subtitle: "Play opponents worldwide", icon: Zap },
];

const platformFeatures = [
  { icon: Crown, title: "Play as Legends", description: "Step into the shoes of Kasparov, Fischer, and more" },
  { icon: BarChart3, title: "Engine Analysis", description: "Compare your moves to the best computer lines" },
  { icon: Users, title: "Challenge Friends", description: "Send private invitations with shareable links" },
  { icon: Sparkles, title: "10K+ Positions", description: "Iconic moments from chess history's greatest games" },
];

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
  const [hoveredLockedButton, setHoveredLockedButton] = useState<"friend" | "quick" | null>(null);

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
        <div className="min-h-screen bg-cb-bg flex items-center justify-center pt-16 md:pt-24">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-2 border-cb-border-strong border-t-cb-text rounded-full animate-spin" />
            <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-cb-text-muted text-sm tracking-wide">
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
        <div className="min-h-screen bg-cb-bg flex items-center justify-center pt-16 md:pt-24 p-4 relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-cb-border p-8 max-w-md text-center"
          >
            <h2
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-2xl text-cb-text mb-3"
            >
              Position Not Found
            </h2>
            <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-cb-text-muted mb-8">
              {error || "This position is not available for demo play."}
            </p>
            <button
              onClick={() => router.push("/try")}
              className="w-full py-4 bg-cb-accent text-cb-accent-fg transition-all duration-300"
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
      <div className="min-h-screen bg-cb-bg flex flex-col lg:flex-row pt-16 sm:pt-18 md:pt-24 relative overflow-hidden">
        {/* Diagonal gradient */}
        <div
          className="absolute inset-0 opacity-60"
          style={{
            background: `linear-gradient(135deg,
              var(--cb-hover) 0%,
              transparent 40%,
              transparent 60%,
              var(--cb-hover) 100%
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
              <div className="h-px flex-1 bg-gradient-to-r from-cb-text-muted to-transparent" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-secondary text-[10px] tracking-[0.4em] uppercase"
              >
                Demo — No Sign-up Required
              </span>
              <div className="h-px flex-1 bg-gradient-to-l from-cb-text-muted to-transparent" />
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
                className="text-3xl sm:text-4xl text-cb-text mb-2"
              >
                {position.whitePlayerName && position.blackPlayerName ? (
                  <>
                    {position.whitePlayerName}
                    <span className="text-cb-text-muted mx-2 text-2xl">vs</span>
                    {position.blackPlayerName}
                  </>
                ) : (
                  title
                )}
              </h1>
              {position.tournamentName && position.whitePlayerName && (
                <div className="flex items-center gap-3 mt-3">
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent to-cb-text-muted" />
                  <span
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-cb-text-secondary text-[10px] tracking-[0.4em] uppercase"
                  >
                    {position.tournamentName}
                  </span>
                  <div className="h-px flex-1 bg-gradient-to-l from-transparent to-cb-text-muted" />
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
                  className="text-cb-text-secondary text-xs tracking-wider uppercase"
                >
                  {boardOrientation === "w" ? "White" : "Black"} to move
                </span>
              </div>
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-muted text-xs tracking-wider uppercase"
              >
                5+3 Blitz
              </span>
            </motion.div>

            {/* Play vs Bot — desktop only inline */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="hidden lg:block mb-3"
            >
              <button
                onClick={handlePlayVsBot}
                disabled={creating}
                className={cn(
                  "group relative w-full flex items-center justify-center gap-2 px-5 py-3.5",
                  "bg-cb-accent text-cb-accent-fg",
                  "transition-all duration-300 overflow-hidden",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                <Bot className="relative z-10 w-4 h-4 group-hover:text-cb-text transition-colors flex-shrink-0" strokeWidth={1.5} />
                <span className="relative z-10 text-sm font-medium group-hover:text-cb-text transition-colors duration-300">
                  {creating ? "Starting..." : "Play vs Bot"}
                </span>
              </button>
            </motion.div>

            {/* Locked game mode buttons */}
            <div className="relative space-y-2 mb-6">
              {lockedModes.map((mode, i) => (
                <motion.div
                  key={mode.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 + i * 0.1 }}
                >
                  <button
                    disabled
                    onMouseEnter={() => setHoveredLockedButton(mode.id)}
                    onMouseLeave={() => setHoveredLockedButton(null)}
                    className="w-full flex items-center justify-between px-5 py-3.5 border border-cb-border text-cb-text-muted cursor-not-allowed transition-colors duration-200 hover:border-cb-border-strong"
                    style={{ fontFamily: "'Geist', sans-serif" }}
                  >
                    <div className="flex items-center gap-2">
                      <mode.icon className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />
                      <div className="text-left">
                        <span className="text-sm font-medium block">{mode.title}</span>
                        <span className="text-[11px] text-cb-text-faint block">{mode.subtitle}</span>
                      </div>
                    </div>
                    <Lock className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.5} />
                  </button>
                </motion.div>
              ))}

              {/* Hover tooltip */}
              <AnimatePresence>
                {hoveredLockedButton && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2 }}
                    className="absolute left-0 right-0 top-full mt-2 z-20"
                    onMouseEnter={() => setHoveredLockedButton(hoveredLockedButton)}
                    onMouseLeave={() => setHoveredLockedButton(null)}
                  >
                    <div className="bg-cb-surface border border-cb-border p-4">
                      <p
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-cb-text-secondary text-sm font-medium mb-1"
                      >
                        Create a free account
                      </p>
                      <p
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-cb-text-muted text-xs mb-3"
                      >
                        Unlock{" "}
                        <span className="text-cb-text-secondary">
                          {lockedModes.find((m) => m.id === hoveredLockedButton)?.title}
                        </span>
                        , multiplayer, analysis, and more
                      </p>
                      <SignInButton forceRedirectUrl="/play">
                        <button
                          className={cn(
                            "group relative w-full flex items-center justify-center gap-2 px-4 py-2.5",
                            "bg-cb-accent text-cb-accent-fg",
                            "transition-all duration-300 overflow-hidden"
                          )}
                          style={{ fontFamily: "'Geist', sans-serif" }}
                        >
                          <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                          <span className="relative z-10 text-sm font-medium group-hover:text-cb-text transition-colors duration-300">
                            Sign Up Free
                          </span>
                        </button>
                      </SignInButton>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Platform value props — 2x2 grid */}
            <div className="grid grid-cols-2 gap-px bg-cb-border mb-6">
              {platformFeatures.map((feature, i) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.9 + i * 0.08 }}
                  className="bg-cb-bg p-4 hover:bg-cb-hover transition-colors duration-300"
                >
                  <feature.icon className="w-4 h-4 text-cb-text-muted mb-2" strokeWidth={1.5} />
                  <h3
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-cb-text-secondary text-xs font-medium mb-1"
                  >
                    {feature.title}
                  </h3>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-cb-text-muted text-[11px] leading-relaxed"
                  >
                    {feature.description}
                  </p>
                </motion.div>
              ))}
            </div>

            {/* Bottom CTA */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2 }}
              className="text-center"
            >
              <SignInButton forceRedirectUrl="/play">
                <button
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-cb-text-muted text-xs tracking-wide hover:text-cb-text-secondary transition-colors duration-300 underline underline-offset-4 decoration-cb-border-strong hover:decoration-cb-text-muted"
                >
                  Create a free account — Unlock everything
                </button>
              </SignInButton>
            </motion.div>

            {/* Mobile sticky bar — Play vs Bot only */}
            <div className="fixed bottom-0 left-0 right-0 z-50 p-3 bg-cb-backdrop backdrop-blur-sm border-t border-cb-border lg:hidden">
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
                    "bg-cb-accent text-cb-accent-fg",
                    "transition-all duration-300 overflow-hidden",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                  <Bot className="relative z-10 w-4 h-4 group-hover:text-cb-text transition-colors flex-shrink-0" strokeWidth={1.5} />
                  <span className="relative z-10 text-sm font-medium group-hover:text-cb-text transition-colors duration-300">
                    {creating ? "Starting..." : "Play vs Bot"}
                  </span>
                </button>
              </motion.div>
            </div>
          </motion.div>
        </div>

        {/* Right Side — Chess Board (desktop only) */}
        <div className="hidden lg:flex flex-1 items-center justify-center p-8 relative">
          <div className="absolute top-0 right-0 w-96 h-96 bg-cb-hover rounded-full blur-3xl" />
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
        <div className="absolute top-20 left-6 w-16 h-16 border-l border-t border-cb-border" />
        <div className="absolute bottom-6 right-6 w-16 h-16 border-r border-b border-cb-border" />
      </div>
    </>
  );
}
