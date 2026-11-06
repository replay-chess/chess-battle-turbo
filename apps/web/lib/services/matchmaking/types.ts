import { MatchmakingStatus } from "@repo/db";

export interface QueueEntry {
  id: bigint;
  referenceId: string;
  userId: bigint;
  rating: number | null;
  timeControlType: string;
  legendReferenceId: string | null;
  timeControlSeconds: number;
  incrementSeconds: number;
  status: MatchmakingStatus;
  createdAt: Date;
  expiresAt: Date;
  matchedAt: Date | null;
  matchedGameRef: string | null;
  user: {
    id: bigint;
    referenceId: string;
    name: string;
    profilePictureUrl: string | null;
  };
}

export interface CreateMatchRequestInput {
  userReferenceId: string;
  legendReferenceId?: string | null;
  openingReferenceId?: string | null;
  initialTimeSeconds: number;
  incrementSeconds: number;
}

export interface CreateMatchRequestResult {
  queueEntry: {
    referenceId: string;
    status: MatchmakingStatus;
    expiresAt: Date;
  };
  immediateMatch?: {
    gameReferenceId: string;
    opponentName: string;
    opponentProfilePictureUrl: string | null;
  };
}

export interface MatchStatusResult {
  status: MatchmakingStatus;
  matchedGameRef: string | null;
  timeRemaining: number;
  opponentInfo?: {
    name: string;
    profilePictureUrl: string | null;
  };
}

export interface MatchedPosition {
  id: bigint;
  referenceId: string;
  fen: string;
  sideToMove: string;
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  tournamentName: string | null;
  whiteLegend?: { profilePhotoUrl: string | null } | null;
  blackLegend?: { profilePhotoUrl: string | null } | null;
}

export type TimeControlType = "bullet" | "blitz" | "rapid" | "daily";

export function getTimeControlType(seconds: number): TimeControlType {
  if (seconds <= 120) return "bullet"; // <= 2 min
  if (seconds <= 300) return "blitz"; // 3-5 min
  if (seconds <= 1800) return "rapid"; // 10-30 min
  return "daily"; // >= 1 day (86400+ seconds)
}

export interface CancelMatchRequestResult {
  status: "cancelled" | "already_cancelled" | "already_expired" | "already_matched";
  matchedGameRef?: string;
}
