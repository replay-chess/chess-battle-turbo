"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Chess } from "chess.js";
import { useRequireAuth, UseRequireAuthReturn } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { motion } from "motion/react";
import { Navbar } from "@/app/components/Navbar";
import ChessBoard from "@/app/components/ChessBoard";
import { ShareLinkModal } from "@/app/play/ShareLinkModal";
import { Swords, Bot, Users, Clock } from "lucide-react";

interface PositionData {
  type: "position" | "opening";
  referenceId: string;
  fen: string;
  sideToMove: string;
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  tournamentName: string | null;
  name: string | null;
  eco: string | null;
  pgn: string | null;
}

const TIME_PRESETS = [
  { label: "3+2", initialTime: 180, increment: 2 },
  { label: "5+3", initialTime: 300, increment: 3 },
  { label: "10+0", initialTime: 600, increment: 0 },
  { label: "15+10", initialTime: 900, increment: 10 },
] as const;

export default function PositionPage({
  params,
}: {
  params: Promise<{ referenceId: string }>;
}) {
  const { isReady, userObject }: UseRequireAuthReturn = useRequireAuth();
  const userReferenceId = userObject?.user?.referenceId;
  const router = useRouter();
  const { referenceId } = use(params);

  const [position, setPosition] = useState<PositionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTimePreset, setSelectedTimePreset] = useState(1); // 5+3
  const [creatingAiGame, setCreatingAiGame] = useState(false);
  const [creatingFriendGame, setCreatingFriendGame] = useState(false);
  const [friendGameLink, setFriendGameLink] = useState<string | null>(null);
  const [friendGameRef, setFriendGameRef] = useState<string | null>(null);

  // Detect type from URL search params
  const [isOpening, setIsOpening] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      setIsOpening(urlParams.get("type") === "opening");
    }
  }, []);

  useEffect(() => {
    async function fetchPosition() {
      try {
        const typeParam = isOpening ? "?type=opening" : "";
        const response = await fetch(`/api/position/${referenceId}${typeParam}`);
        const data = await response.json();

        if (!data.success) {
          setError(data.error || "Position not found");
          return;
        }

        setPosition(data.data);
      } catch (err) {
        logger.error("Error fetching position:", err);
        setError("Failed to load position");
      } finally {
        setLoading(false);
      }
    }

    fetchPosition();
  }, [referenceId, isOpening]);

  const handlePlayVsBot = async () => {
    if (!userReferenceId || !position) return;
    setCreatingAiGame(true);
    try {
      const preset = TIME_PRESETS[selectedTimePreset] ?? TIME_PRESETS[1];
      const body: Record<string, unknown> = {
        userReferenceId,
        initialTimeSeconds: preset.initialTime,
        incrementSeconds: preset.increment,
      };

      if (position.type === "opening") {
        body.selectedOpening = position.referenceId;
      } else {
        body.chessPositionReferenceId = position.referenceId;
      }

      const response = await fetch("/api/chess/create-ai-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to create game");
      }

      router.push(`/game/${data.data.game.referenceId}`);
    } catch (err) {
      logger.error("Error creating AI game:", err);
      setCreatingAiGame(false);
    }
  };

  const handleChallengeAFriend = async () => {
    if (!userReferenceId || !position) return;
    setCreatingFriendGame(true);
    try {
      const preset = TIME_PRESETS[selectedTimePreset] ?? TIME_PRESETS[1];
      const body: Record<string, unknown> = {
        userReferenceId,
        initialTimeSeconds: preset.initialTime,
        incrementSeconds: preset.increment,
        gameMode: "friend",
        playAsLegend: false,
        selectedLegend: null,
      };

      if (position.type === "opening") {
        body.selectedOpening = position.referenceId;
      } else {
        body.chessPositionReferenceId = position.referenceId;
      }

      const response = await fetch("/api/chess/create-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to create game");
      }

      const origin = window.location.origin;
      setFriendGameRef(data.data.game.referenceId);
      setFriendGameLink(`${origin}/join/${data.data.game.referenceId}?autojoin=true`);
    } catch (err) {
      logger.error("Error creating friend game:", err);
      setCreatingFriendGame(false);
    }
  };

  if (loading || !isReady) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-black flex items-center justify-center pt-16 md:pt-24">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-4"
          >
            <div className="w-12 h-12 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-white/40 text-sm tracking-wide"
            >
              Loading position...
            </p>
          </motion.div>
        </div>
      </>
    );
  }

  if (error || !position) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-black flex items-center justify-center pt-16 md:pt-24 p-4 relative">
          <div
            className="absolute inset-0 opacity-[0.015]"
            style={{
              backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
              backgroundSize: "60px 60px",
            }}
          />
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative z-10 border border-white/10 p-8 max-w-md text-center"
          >
            <div className="w-16 h-16 border border-white/20 flex items-center justify-center mx-auto mb-6">
              <span className="text-2xl text-white/40">&times;</span>
            </div>
            <h2
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-2xl text-white mb-3"
            >
              Position Not Found
            </h2>
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-white/40 mb-8"
            >
              {error || "This position doesn't exist or is no longer available."}
            </p>
            <button
              onClick={() => router.push("/play")}
              className={cn(
                "group relative w-full flex items-center justify-center gap-2 px-8 py-4",
                "bg-white text-black",
                "transition-all duration-300 overflow-hidden"
              )}
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              <span className="absolute inset-0 bg-black origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
              <span className="relative z-10 font-medium group-hover:text-white transition-colors duration-300">
                Go to Play
              </span>
            </button>
          </motion.div>
        </div>
      </>
    );
  }

  const boardOrientation =
    position.sideToMove === "black" || position.sideToMove === "b" ? "b" : "w";

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-black flex flex-col lg:flex-row pt-16 sm:pt-18 md:pt-24 relative overflow-hidden">
        {/* Diagonal gradient — matches play page */}
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

        {/* Left Side — Details & Controls */}
        <div className="flex-1 flex items-center justify-center pt-4 sm:pt-2 lg:pt-6 px-6 sm:px-8 lg:px-12 pb-4 lg:pb-0 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-md"
          >
            {/* Divider label */}
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
                {position.type === "opening" ? "Opening" : "Shared Position"}
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
              {position.type === "opening" ? (
                <div>
                  <h1
                    style={{ fontFamily: "'Instrument Serif', serif" }}
                    className="text-3xl sm:text-4xl text-white mb-2"
                  >
                    {position.name}
                  </h1>
                  {position.eco && (
                    <p
                      style={{ fontFamily: "'Geist Mono', monospace" }}
                      className="text-white/40 text-sm"
                    >
                      {position.eco}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  {position.whitePlayerName && position.blackPlayerName ? (
                    <h1
                      style={{ fontFamily: "'Instrument Serif', serif" }}
                      className="text-3xl sm:text-4xl text-white mb-2"
                    >
                      {position.whitePlayerName}
                      <span className="text-white/30 mx-2 text-2xl">vs</span>
                      {position.blackPlayerName}
                    </h1>
                  ) : (
                    <h1
                      style={{ fontFamily: "'Instrument Serif', serif" }}
                      className="text-3xl sm:text-4xl text-white mb-2"
                    >
                      Shared Position
                    </h1>
                  )}
                  {position.tournamentName && (
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-white/40 text-sm"
                    >
                      {position.tournamentName}
                    </p>
                  )}
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

            {/* Side to move indicator */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="flex items-center gap-2 mb-6"
            >
              <div
                className={cn(
                  "w-4 h-4 rounded-full border",
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
            </motion.div>

            {/* Time control */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45 }}
              className="mb-6 lg:mb-8"
            >
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-white/30" strokeWidth={1.5} />
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-xs text-white/40 uppercase tracking-wide"
                >
                  Time Control
                </span>
              </div>
              <div className="flex gap-2">
                {TIME_PRESETS.map((preset, i) => (
                  <button
                    key={preset.label}
                    onClick={() => setSelectedTimePreset(i)}
                    className={cn(
                      "flex-1 py-3 text-sm border transition-all duration-200",
                      selectedTimePreset === i
                        ? "border-white/40 text-white bg-white/10"
                        : "border-white/10 text-white/40 hover:border-white/20 hover:text-white/60"
                    )}
                    style={{ fontFamily: "'Instrument Serif', serif" }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </motion.div>

            {/* Action buttons */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="space-y-3"
            >
              {/* Challenge a Friend — primary */}
              <button
                onClick={handleChallengeAFriend}
                disabled={creatingAiGame || creatingFriendGame}
                className={cn(
                  "group relative w-full flex items-center justify-center gap-2.5 px-6 py-4",
                  "bg-white text-black",
                  "transition-all duration-300 overflow-hidden",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                <span className="absolute inset-0 bg-black origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                <Users className="relative z-10 w-4 h-4 group-hover:text-white transition-colors" strokeWidth={1.5} />
                <span className="relative z-10 font-medium group-hover:text-white transition-colors duration-300">
                  {creatingFriendGame ? "Creating..." : "Challenge a Friend"}
                </span>
              </button>

              {/* Play vs Bot — secondary */}
              <button
                onClick={handlePlayVsBot}
                disabled={creatingAiGame || creatingFriendGame}
                className={cn(
                  "w-full flex items-center justify-center gap-2.5 px-6 py-4",
                  "border border-white/10 hover:border-white/30",
                  "text-white/60 hover:text-white transition-all duration-300",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                <Bot className="w-4 h-4" strokeWidth={1.5} />
                <span>{creatingAiGame ? "Creating..." : "Play vs Bot"}</span>
              </button>
            </motion.div>
          </motion.div>
        </div>

        {/* Right Side — Chess Board (desktop only) */}
        <div className="hidden lg:flex flex-1 items-center justify-center p-8 relative">
          {/* Subtle light source */}
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

      {/* Share link modal for friend game */}
      <ShareLinkModal
        isOpen={!!friendGameLink}
        inviteLink={friendGameLink || ""}
        onGoToGame={() => {
          if (friendGameRef) {
            router.push(`/game/${friendGameRef}`);
          }
        }}
        onCancel={async () => {
          await fetch("/api/chess/cancel-game", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              gameReferenceId: friendGameRef,
              userReferenceId,
            }),
          });
          setFriendGameLink(null);
          setFriendGameRef(null);
          setCreatingFriendGame(false);
        }}
      />
    </>
  );
}
