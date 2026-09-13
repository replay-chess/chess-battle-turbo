"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { MatchmakingStatus } from "@/app/generated/prisma";
import { useRouter } from "next/navigation";
import { trackApiResponseTime } from "@/lib/metrics";
import { currentAppPath, isSubscriptionRequiredResponse, paywallUrl } from "@/lib/billing/client";

export interface OpponentInfo {
  name: string;
  profilePictureUrl: string | null;
}

export interface UseMatchmakingOptions {
  queueReferenceId: string | null;
  onMatchFound: (gameReferenceId: string, opponentInfo: OpponentInfo) => void;
  onTimeout: () => void;
  onError: (error: string) => void;
  enabled?: boolean;
}

export interface UseMatchmakingReturn {
  status: MatchmakingStatus;
  timeRemaining: number;
  opponentInfo: OpponentInfo | null;
  cancel: () => Promise<void>;
  isLoading: boolean;
}

const POLL_INTERVAL_MS = 1000;

export function useMatchmaking(
  options: UseMatchmakingOptions
): UseMatchmakingReturn {
  const [status, setStatus] = useState<MatchmakingStatus>("SEARCHING");
  const [timeRemaining, setTimeRemaining] = useState(60);
  const [opponentInfo, setOpponentInfo] = useState<OpponentInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasCalledMatchFoundRef = useRef(false);

  // Store callbacks in refs to avoid recreating effects
  const onMatchFoundRef = useRef(options.onMatchFound);
  const onTimeoutRef = useRef(options.onTimeout);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    onMatchFoundRef.current = options.onMatchFound;
    onTimeoutRef.current = options.onTimeout;
    onErrorRef.current = options.onError;
  }, [options.onMatchFound, options.onTimeout, options.onError]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Only poll if we have a valid queueReferenceId and polling is enabled
  const shouldPoll = !!(options.queueReferenceId && (options.enabled !== false));

  useEffect(() => {
    // Don't poll if no queueReferenceId or disabled
    if (!shouldPoll) {
      return;
    }

    const queueRefId = options.queueReferenceId!;

    const pollMatchStatus = async () => {
      try {
        const response = await fetch(
          `/api/matchmaking/match-status?referenceId=${queueRefId}`
        );
        const data = await response.json();

        if (!data.success) {
          stopPolling();
          onErrorRef.current(data.error || "Failed to check match status");
          return;
        }

        const { status: newStatus, matchedGameRef, timeRemaining: newTimeRemaining, opponentInfo: newOpponentInfo } = data.data;

        setTimeRemaining(newTimeRemaining);

        if (newStatus === "MATCHED" && matchedGameRef) {
          stopPolling();
          setStatus("MATCHED");
          setOpponentInfo(newOpponentInfo || null);
          // Prevent calling onMatchFound multiple times
          if (!hasCalledMatchFoundRef.current) {
            hasCalledMatchFoundRef.current = true;
            onMatchFoundRef.current(matchedGameRef, newOpponentInfo);
          }
        } else if (newStatus === "EXPIRED") {
          stopPolling();
          setStatus("EXPIRED");
          onTimeoutRef.current();
        } else if (newStatus === "CANCELLED") {
          stopPolling();
          setStatus("CANCELLED");
        } else {
          setStatus(newStatus);
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error("Error polling match status:", error);
        }
        // Don't stop polling on network error - try again next interval
      }
    };

    // Initial poll
    pollMatchStatus();

    // Set up interval
    intervalRef.current = setInterval(pollMatchStatus, POLL_INTERVAL_MS);

    // Cleanup on unmount or when queueReferenceId changes
    return () => {
      stopPolling();
    };
  }, [shouldPoll, options.queueReferenceId, stopPolling]);

  const cancel = useCallback(async () => {
    if (!options.queueReferenceId) {
      setStatus("CANCELLED");
      return;
    }

    setIsLoading(true);
    stopPolling();

    try {
      // Note: userReferenceId needs to be passed from the parent component
      // The cancel API will be called from the queue page with the full data
      setStatus("CANCELLED");
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error("Error cancelling match request:", error);
      }
      onErrorRef.current(
        error instanceof Error ? error.message : "Failed to cancel"
      );
    } finally {
      setIsLoading(false);
    }
  }, [options.queueReferenceId, stopPolling]);

  return {
    status,
    timeRemaining,
    opponentInfo,
    cancel,
    isLoading,
  };
}

/**
 * Helper hook for creating a match request and handling the result
 */
export interface UseCreateMatchRequestOptions {
  onSuccess: (result: {
    queueReferenceId: string;
    immediateMatch?: {
      gameReferenceId: string;
      opponentName: string;
      opponentProfilePictureUrl: string | null;
    };
  }) => void;
  onError: (error: string) => void;
}

export interface UseCreateMatchRequestReturn {
  createMatchRequest: (params: {
    userReferenceId: string;
    legendReferenceId?: string | null;
    initialTimeSeconds: number;
    incrementSeconds: number;
  }) => Promise<void>;
  isCreating: boolean;
}

export function useCreateMatchRequest(
  options: UseCreateMatchRequestOptions
): UseCreateMatchRequestReturn {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  const createMatchRequest = useCallback(
    async (params: {
      userReferenceId: string;
      legendReferenceId?: string | null;
      initialTimeSeconds: number;
      incrementSeconds: number;
    }) => {
      setIsCreating(true);

      try {
        const start = Date.now();
        const response = await fetch("/api/matchmaking/create-match-request", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(params),
        });

        if (await isSubscriptionRequiredResponse(response)) {
          router.push(paywallUrl(currentAppPath()));
          return;
        }

        const data = await response.json();
        trackApiResponseTime("matchmaking.create", Date.now() - start);

        if (!data.success) {
          throw new Error(data.error || "Failed to create match request");
        }

        options.onSuccess({
          queueReferenceId: data.data.queueEntry.referenceId,
          immediateMatch: data.data.immediateMatch,
        });
      } catch (error) {
        options.onError(
          error instanceof Error ? error.message : "Failed to create match request"
        );
      } finally {
        setIsCreating(false);
      }
    },
    [options, router]
  );

  return {
    createMatchRequest,
    isCreating,
  };
}
