import { useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { retryOnUnauthorized, useSocketToken } from "./useSocketToken";

interface TournamentParticipant {
  referenceId: string;
  points: string;
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
  isSearching: boolean;
  joinedAt: string;
  user: {
    referenceId: string;
    name: string;
    profilePictureUrl: string | null;
  };
}

interface ActiveGame {
  referenceId: string;
  creator: { referenceId: string; name: string; profilePictureUrl: string | null };
  opponent: { referenceId: string; name: string; profilePictureUrl: string | null } | null;
  startedAt: string | null;
}

export interface TournamentData {
  referenceId: string;
  name: string;
  description: string;
  mode: string;
  status: string;
  maxParticipants: number | null;
  initialTimeSeconds: number;
  incrementSeconds: number;
  durationMinutes: number;
  scheduledStartAt: string;
  startedAt: string | null;
  endsAt: string | null;
  completedAt: string | null;
  createdAt: string;
  createdBy: {
    referenceId: string;
    name: string;
    profilePictureUrl: string | null;
  };
  opening: { referenceId: string; name: string; eco: string } | null;
  legend: { referenceId: string; name: string; profilePhotoUrl: string | null } | null;
  chessPosition: { referenceId: string; fen: string } | null;
  participants: TournamentParticipant[];
  participantCount: number;
  isParticipant: boolean;
  currentUserParticipant: (TournamentParticipant & { rank: number }) | null;
  activeGames: ActiveGame[];
}

const DEBOUNCE_MS = 2000;

export function useTournamentLobby(tournamentReferenceId: string) {
  const [tournament, setTournament] = useState<TournamentData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFetching = useRef(false);
  // Warms the socket auth token cache; `auth` is a stable module-level function.
  const { auth } = useSocketToken();

  const fetchTournament = useCallback(async () => {
    try {
      const res = await fetch(`/api/tournament/${tournamentReferenceId}`);
      const data = await res.json();
      if (data.success) {
        setTournament(data.data);
        setError(null);
      } else {
        setError(data.error || "Failed to load tournament");
      }
    } catch {
      setError("Failed to load tournament");
    } finally {
      setIsLoading(false);
      isFetching.current = false;
    }
  }, [tournamentReferenceId]);

  // Debounced fetch: coalesces rapid-fire WebSocket events into a single API call
  const debouncedFetch = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => {
      if (!isFetching.current) {
        isFetching.current = true;
        fetchTournament();
      }
    }, DEBOUNCE_MS);
  }, [fetchTournament]);

  // Initial fetch (immediate, no debounce)
  useEffect(() => {
    fetchTournament();
  }, [fetchTournament]);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  // Socket connection for real-time updates
  useEffect(() => {
    const WEBSOCKET_URL =
      process.env.NEXT_PUBLIC_WEBSOCKET_URL || "ws://localhost:3002";

    const socket = io(WEBSOCKET_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      // Signed user token, fetched before each (re)connect. Falls back to an
      // empty handshake if the token cannot be fetched (see useSocketToken).
      auth,
    });
    const stopAuthRetry = retryOnUnauthorized(socket);

    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join_tournament_lobby", { tournamentReferenceId });
    });

    // All events go through debounced fetch — coalesces rapid events
    socket.on("tournament_player_joined", debouncedFetch);
    socket.on("tournament_started", fetchTournament); // Immediate — rare, important
    socket.on("tournament_game_started", debouncedFetch);
    socket.on("tournament_game_ended", debouncedFetch);
    socket.on("tournament_ended", fetchTournament); // Immediate — rare, important

    return () => {
      stopAuthRetry();
      socket.emit("leave_tournament_lobby", { tournamentReferenceId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [tournamentReferenceId, fetchTournament, debouncedFetch, auth]);

  return {
    tournament,
    isLoading,
    error,
    refetch: fetchTournament,
  };
}
