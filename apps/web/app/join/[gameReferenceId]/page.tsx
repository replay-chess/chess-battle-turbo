"use client";

import React, { useEffect, useState, useRef, use } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { cn, getInitials } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { useRequireAuth, UseRequireAuthReturn } from "@/lib/hooks";
import { motion } from "motion/react";
import { Navbar } from "@/app/components/Navbar";
import { Swords, Clock } from "lucide-react";
import { Chess } from "chess.js";
import ChessBoard from "@/app/components/ChessBoard";

interface PositionInfo {
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  tournamentName?: string | null;
  openingName?: string | null;
  openingEco?: string | null;
}

interface GameDetails {
  referenceId: string;
  status: string;
  initialTimeSeconds: number;
  incrementSeconds: number;
  startingFen?: string;
  gameData?: {
    positionInfo?: PositionInfo;
    gameMode?: string;
    [key: string]: unknown;
  };
  creator: {
    userReferenceId: string;
    name: string;
    profilePictureUrl: string | null;
    code: string;
  };
  opponent?: {
    userReferenceId: string;
    name: string;
    profilePictureUrl: string | null;
    code: string;
  };
}

export default function JoinPage({
  params,
}: {
  params: Promise<{ gameReferenceId: string }>;
}) {
  const { isReady, userObject }: UseRequireAuthReturn = useRequireAuth();
  const userReferenceId = userObject?.user?.referenceId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [gameDetails, setGameDetails] = useState<GameDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const autoJoinAttempted = useRef(false);

  const { gameReferenceId } = use(params);

  useEffect(() => {
    async function fetchGameDetails() {
      try {
        const response = await fetch(
          `/api/chess/game-by-ref/${gameReferenceId}`
        );
        const data = await response.json();

        if (!data.success) {
          setError(data.error || "Failed to fetch game details");
          return;
        }

        setGameDetails(data.data);
      } catch (err) {
        logger.error("Error fetching game:", err);
        setError("Failed to load game details");
      } finally {
        setLoading(false);
      }
    }

    fetchGameDetails();
  }, [gameReferenceId]);

  const handleJoinGame = async () => {
    if (!gameDetails) return;

    setJoining(true);

    try {
      const response = await fetch("/api/chess/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gameReferenceId: gameDetails.referenceId,
          opponentReferenceId: userReferenceId,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to join game");
      }

      router.push(`/game/${gameDetails.referenceId}`);
    } catch (err) {
      logger.error("Error joining game:", err);
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to join game. Please try again."
      );
      setJoining(false);
      autoJoinAttempted.current = true;
    }
  };

  // Auto-join when ?autojoin=true
  useEffect(() => {
    if (
      !autoJoinAttempted.current &&
      searchParams.get("autojoin") === "true" &&
      isReady &&
      userReferenceId &&
      gameDetails &&
      gameDetails.status === "WAITING_FOR_OPPONENT" &&
      !joining
    ) {
      autoJoinAttempted.current = true;
      handleJoinGame();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, userReferenceId, gameDetails, joining, searchParams]);

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
            <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/40 text-sm tracking-wide">
              {searchParams.get("autojoin") === "true" ? "Joining game..." : "Loading..."}
            </p>
          </motion.div>
        </div>
      </>
    );
  }

  if (error || !gameDetails) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-black flex items-center justify-center pt-16 md:pt-24 p-4 relative">
          {/* Grid background */}
          <div
            className="absolute inset-0 opacity-[0.015]"
            style={{
              backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
              backgroundSize: '60px 60px',
            }}
          />

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative z-10 border border-white/10 p-8 max-w-md text-center"
          >
            <div className="w-16 h-16 border border-white/20 flex items-center justify-center mx-auto mb-6">
              <span className="text-2xl text-white/40">×</span>
            </div>
            <h2
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-2xl text-white mb-3"
            >
              Game Not Found
            </h2>
            <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/40 mb-8">
              {error || "This game doesn't exist or is no longer available."}
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
                Create New Game
              </span>
            </button>
          </motion.div>
        </div>
      </>
    );
  }

  const alreadyStarted = gameDetails.status !== "WAITING_FOR_OPPONENT";
  const positionInfo = gameDetails.gameData?.positionInfo;
  const startingFen = gameDetails.startingFen;

  // If auto-joining, show a joining state
  if (joining) {
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
            <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/40 text-sm tracking-wide">
              Joining game...
            </p>
          </motion.div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-black flex items-center justify-center pt-16 md:pt-24 sm:pt-20 p-4 relative">
        {/* Grid background */}
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 border border-white/10 p-6 sm:p-10 max-w-xl w-full"
        >
          {/* Header with Swords icon */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-center mb-8"
          >
            <div className="w-16 h-16 bg-white flex items-center justify-center mx-auto mb-6">
              <Swords className="w-8 h-8 text-black" strokeWidth={1.5} />
            </div>
            <h1
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-3xl sm:text-4xl text-white"
            >
              Chess Challenge
            </h1>
          </motion.div>

          {/* Creator Info */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="border border-white/10 p-5 mb-6"
          >
            <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-xs text-white/40 uppercase tracking-widest mb-4">
              Challenge from
            </p>
            <div className="flex items-center gap-4">
              {gameDetails.creator.profilePictureUrl ? (
                <Image
                  src={gameDetails.creator.profilePictureUrl}
                  alt={gameDetails.creator.name}
                  width={56}
                  height={56}
                  className="w-14 h-14 object-cover grayscale"
                />
              ) : (
                <div className="w-14 h-14 bg-white flex items-center justify-center">
                  <span
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm font-bold text-black"
                  >
                    {getInitials(gameDetails.creator.name)}
                  </span>
                </div>
              )}
              <div>
                <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-lg font-medium text-white">
                  {gameDetails.creator.name}
                </p>
                <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-sm text-white/30">
                  @{gameDetails.creator.code}
                </p>
              </div>
            </div>
          </motion.div>

          {/* Position Preview */}
          {startingFen && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="mb-6"
            >
              <div className="border border-white/10 p-4">
                <div className="max-w-[280px] mx-auto mb-3">
                  <ChessBoard
                    board={new Chess(startingFen).board()}
                    isInteractive={false}
                    showCoordinates={false}
                    squareSize="responsive-md"
                  />
                </div>
                {positionInfo && (
                  <div className="text-center">
                    {positionInfo.openingName ? (
                      <div className="flex items-center justify-center gap-2">
                        {positionInfo.openingEco && (
                          <span
                            style={{ fontFamily: "'Geist', sans-serif" }}
                            className="text-[10px] tracking-wider text-white/50 bg-white/10 px-1.5 py-0.5 uppercase"
                          >
                            {positionInfo.openingEco}
                          </span>
                        )}
                        <p
                          style={{ fontFamily: "'Instrument Serif', serif" }}
                          className="text-white/50 text-sm italic"
                        >
                          {positionInfo.openingName}
                        </p>
                      </div>
                    ) : positionInfo.whitePlayerName && positionInfo.blackPlayerName ? (
                      <p
                        style={{ fontFamily: "'Instrument Serif', serif" }}
                        className="text-white/50 text-sm"
                      >
                        {positionInfo.whitePlayerName}
                        <span className="text-white/20 mx-1.5">vs</span>
                        {positionInfo.blackPlayerName}
                      </p>
                    ) : null}
                    {positionInfo.tournamentName && (
                      <p
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-white/30 text-xs mt-1"
                      >
                        {positionInfo.tournamentName}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Game Details */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mb-6"
          >
            <div className="border border-white/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-white/30" strokeWidth={1.5} />
                <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-xs text-white/40 uppercase tracking-wide">
                  Time Control
                </span>
              </div>
              <p style={{ fontFamily: "'Instrument Serif', serif" }} className="text-2xl text-white">
                {gameDetails.initialTimeSeconds / 60}+{gameDetails.incrementSeconds}
              </p>
            </div>
          </motion.div>

          {/* Warning for already started games */}
          {alreadyStarted && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="border border-white/20 p-4 mb-6"
            >
              <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/60 text-center text-sm">
                This game has already started or is no longer available.
              </p>
            </motion.div>
          )}

          {/* Action Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="space-y-3"
          >
            <button
              data-testid="accept-challenge-button"
              onClick={handleJoinGame}
              disabled={joining || alreadyStarted}
              className={cn(
                "group relative w-full flex items-center justify-center gap-2 px-6 py-4",
                "transition-all duration-300 overflow-hidden",
                alreadyStarted
                  ? "bg-white/10 text-white/30 cursor-not-allowed"
                  : "bg-white text-black",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              {!alreadyStarted && (
                <span className="absolute inset-0 bg-black origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
              )}
              <span className={cn(
                "relative z-10 font-medium transition-colors duration-300",
                !alreadyStarted && "group-hover:text-white"
              )}>
                {joining
                  ? "Joining..."
                  : alreadyStarted
                    ? "Unavailable"
                    : "Accept Challenge"}
              </span>
            </button>

            <button
              onClick={() => router.push("/")}
              disabled={joining}
              className="w-full text-center py-2 text-white/40 hover:text-white/60 transition-colors text-sm"
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              Cancel
            </button>
          </motion.div>
        </motion.div>
      </div>
    </>
  );
}
