"use client";

import React, { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { logger } from "@/lib/logger";
import { trackApiResponseTime } from "@/lib/metrics";
import { Navbar } from "@/app/components/Navbar";
import {
  QueueSearching,
  MatchFound,
  NoOpponentPopup,
} from "@/app/components/matchmaking";
import {
  useMatchmaking,
  OpponentInfo,
} from "@/lib/hooks/useMatchmaking";
import { useRequireAuth, UseRequireAuthReturn } from "@/lib/hooks/useRequireAuth";
import { motion } from "motion/react";

type QueueState = "initializing" | "searching" | "timeout" | "matched" | "error";

function QueueContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isReady, userObject }: UseRequireAuthReturn = useRequireAuth();

  const [queueState, setQueueState] = useState<QueueState>("initializing");
  const [queueReferenceId, setQueueReferenceId] = useState<string | null>(null);
  const [opponentInfo, setOpponentInfo] = useState<OpponentInfo | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [gameReferenceId, setGameReferenceId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingBotGame, setIsCreatingBotGame] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const hasInitiatedRef = useRef(false);
  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const queueStateRef = useRef<QueueState>(queueState);

  const initialTimeSeconds = parseInt(searchParams.get("time") || "300", 10);
  const incrementSeconds = parseInt(searchParams.get("increment") || "5", 10);
  const legendReferenceId = searchParams.get("legend") || null;
  const legendName = searchParams.get("legendName") || null;
  const openingReferenceId = searchParams.get("opening") || null;

  const getTimeControlLabel = () => {
    const mins = Math.floor(initialTimeSeconds / 60);
    if (incrementSeconds > 0) {
      return `${mins} | ${incrementSeconds}`;
    }
    return `${mins} min`;
  };

  const redirectToGame = useCallback((gameRef: string) => {
    if (redirectTimeoutRef.current) {
      clearTimeout(redirectTimeoutRef.current);
    }
    redirectTimeoutRef.current = setTimeout(() => {
      router.replace(`/game/${gameRef}`);
    }, 1500);
  }, [router]);

  const createMatchRequest = useCallback(async () => {
    if (!userObject?.user?.referenceId) return;

    setIsCreating(true);
    try {
      const start = Date.now();
      const response = await fetch("/api/matchmaking/create-match-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userReferenceId: userObject.user.referenceId,
          legendReferenceId,
          openingReferenceId,
          initialTimeSeconds,
          incrementSeconds,
        }),
      });

      const data = await response.json();
      trackApiResponseTime("matchmaking.create", Date.now() - start);

      if (!data.success) {
        throw new Error(data.error || "Failed to create match request");
      }

      if (data.data.immediateMatch) {
        setQueueState("matched");
        setOpponentInfo({
          name: data.data.immediateMatch.opponentName,
          profilePictureUrl: data.data.immediateMatch.opponentProfilePictureUrl,
        });
        setGameReferenceId(data.data.immediateMatch.gameReferenceId);
        redirectToGame(data.data.immediateMatch.gameReferenceId);
      } else {
        setQueueReferenceId(data.data.queueEntry.referenceId);
        setQueueState("searching");
      }
    } catch (error) {
      logger.error("Error creating match request:", error);
      setErrorMessage(error instanceof Error ? error.message : "Failed to create match request");
      setQueueState("error");
    } finally {
      setIsCreating(false);
    }
  }, [userObject?.user?.referenceId, legendReferenceId, openingReferenceId, initialTimeSeconds, incrementSeconds, redirectToGame]);

  useEffect(() => {
    if (!isReady || !userObject?.user?.referenceId) return;
    if (hasInitiatedRef.current) return;

    hasInitiatedRef.current = true;
    createMatchRequest();

    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, [isReady, userObject?.user?.referenceId, createMatchRequest]);

  // Keep queueStateRef in sync with queueState
  useEffect(() => {
    queueStateRef.current = queueState;
  }, [queueState]);

  // Cleanup effect - handles browser close and navigation
  useEffect(() => {
    if (!queueReferenceId || !userObject?.user?.referenceId) return;
    if (queueState === "matched") return; // Don't cancel if matched

    const userReferenceId = userObject.user.referenceId;

    const cancelData = new URLSearchParams({
      queueReferenceId,
      userReferenceId,
    });

    const handleUnload = () => {
      navigator.sendBeacon("/api/matchmaking/cancel-beacon", cancelData);
    };

    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);

    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);

      // React unmount (in-app navigation) - use keepalive fetch
      // Use ref to get current state at cleanup time
      if (queueStateRef.current !== "matched") {
        fetch("/api/matchmaking/cancel-match-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queueReferenceId, userReferenceId }),
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, [queueReferenceId, userObject?.user?.referenceId, queueState]);

  const handleMatchFound = useCallback(
    (gameRef: string, opponent: OpponentInfo) => {
      setQueueState("matched");
      setOpponentInfo(opponent);
      setGameReferenceId(gameRef);
      redirectToGame(gameRef);
    },
    [redirectToGame]
  );

  const handleTimeout = useCallback(async () => {
    // Cancel the queue entry immediately on timeout
    if (userObject?.user?.referenceId && queueReferenceId) {
      try {
        await fetch("/api/matchmaking/cancel-match-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            queueReferenceId,
            userReferenceId: userObject.user.referenceId,
          }),
        });
      } catch (error) {
        logger.error("Error cancelling queue entry on timeout:", error);
      }
    }

    setQueueReferenceId(null);
    setQueueState("timeout");
  }, [userObject?.user?.referenceId, queueReferenceId]);

  const handleError = useCallback((error: string) => {
    logger.error("Matchmaking error: " + error);
  }, []);

  const matchmaking = useMatchmaking({
    queueReferenceId,
    onMatchFound: handleMatchFound,
    onTimeout: handleTimeout,
    onError: handleError,
    enabled: queueState === "searching" && !!queueReferenceId,
  });

  const handleCancel = async () => {
    setIsCancelling(true);
    if (userObject?.user?.referenceId && queueReferenceId) {
      try {
        await fetch("/api/matchmaking/cancel-match-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            queueReferenceId,
            userReferenceId: userObject.user.referenceId,
          }),
        });
      } catch (error) {
        logger.error("Error cancelling:", error);
      }
    }
    router.replace("/play");
  };

  const handleRetry = async () => {
    // Queue entry already cancelled on timeout, just reset state and retry
    setQueueState("initializing");
    setErrorMessage(null);
    setOpponentInfo(null);
    setGameReferenceId(null);
    await createMatchRequest();
  };

  const handleBack = async () => {
    if (queueReferenceId && userObject?.user?.referenceId && queueState !== "matched") {
      await fetch("/api/matchmaking/cancel-match-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queueReferenceId,
          userReferenceId: userObject.user.referenceId,
        }),
      }).catch(() => {});
    }
    router.replace("/play");
  };

  const handlePlayBot = async () => {
    if (!userObject?.user?.referenceId) return;

    setIsCreatingBotGame(true);
    try {
      const start = Date.now();
      const response = await fetch("/api/chess/create-ai-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userReferenceId: userObject.user.referenceId,
          initialTimeSeconds,
          incrementSeconds,
          ...(legendReferenceId && { selectedLegend: legendReferenceId }),
        }),
      });

      const data = await response.json();
      trackApiResponseTime("chess.createAiGame", Date.now() - start);

      if (!data.success) {
        throw new Error(data.error || "Failed to create AI game");
      }

      router.replace(`/game/${data.data.game.referenceId}`);
    } catch (error) {
      logger.error("Error creating AI game:", error);
      setErrorMessage(error instanceof Error ? error.message : "Failed to create AI game");
      setQueueState("error");
    } finally {
      setIsCreatingBotGame(false);
    }
  };

  if (!isReady) {
    return (
      <div className="flex min-h-screen bg-black items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="w-12 h-12 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/40 text-sm tracking-wide">
            Loading...
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-black flex items-center justify-center pt-16 sm:pt-18 md:pt-24 relative">
        {/* Subtle grid background */}
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
          }}
        />

        <div className="w-full max-w-lg p-4 relative z-10">
          {/* Error state */}
          {queueState === "error" && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center space-y-6"
            >
              <div className="w-16 h-16 border border-white/20 flex items-center justify-center mx-auto">
                <span className="text-2xl">✕</span>
              </div>
              <h2
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-2xl text-white"
              >
                Something went wrong
              </h2>
              <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/40">
                {errorMessage || "An error occurred"}
              </p>
              <button
                onClick={handleBack}
                className="px-8 py-3 border border-white/20 text-white hover:bg-white hover:text-black transition-all duration-300"
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                Back to Play
              </button>
            </motion.div>
          )}

          {/* Initializing or Searching state */}
          {(queueState === "initializing" || queueState === "searching") && (
            <QueueSearching
              timeRemaining={queueReferenceId ? matchmaking.timeRemaining : 60}
              onCancel={handleCancel}
              isLoading={isCreating || matchmaking.isLoading}
              isCancelling={isCancelling}
              timeControlLabel={getTimeControlLabel()}
            />
          )}

          {/* Timeout state - Full screen popup */}
          {queueState === "timeout" && (
            <NoOpponentPopup
              isOpen={true}
              onPlayBot={handlePlayBot}
              onRetry={handleRetry}
              onBack={handleBack}
              isCreatingBotGame={isCreatingBotGame}
              isRetrying={isCreating}
              timeControl={{ time: initialTimeSeconds, increment: incrementSeconds }}
              legendName={legendName}
            />
          )}

          {/* Matched state */}
          {queueState === "matched" && opponentInfo && (
            <MatchFound
              opponentName={opponentInfo.name}
              opponentProfilePictureUrl={opponentInfo.profilePictureUrl}
            />
          )}
        </div>
      </div>
    </>
  );
}

export default function QueuePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen bg-black items-center justify-center">
          <div className="w-12 h-12 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      }
    >
      <QueueContent />
    </Suspense>
  );
}
