// Who may do what with a game (phase-02 plan §11.1). Pure rules over the row the services already read, so the RSC
// page, GET /api/games/[ref], checkpoint, complete and PGN decide the same way. The role always comes from the
// server's columns (whitePlayerId / blackPlayerId), never from the client (§11.2 rule 2).
import { logger } from "@/lib/logger";
import type { GameRow } from "./snapshot.server";

import type { Side } from "@repo/contracts/socket/game";

/** The wire colour type (one source: `@repo/contracts/socket/game`). */
export type { Side };

export type GameRole = { role: "player"; color: Side | null } | { role: "spectator" } | { role: "none" };

/** The viewer's place in a game. Legacy rows without fixed colours fall back to creator/opponent (colour unknown). */
export function roleIn(row: Pick<GameRow, "whitePlayerId" | "blackPlayerId" | "creatorId" | "opponentId" | "mode">, viewerId: bigint | null | undefined): GameRole {
  if (viewerId == null) return { role: "none" };
  if (row.whitePlayerId === viewerId) return { role: "player", color: "w" };
  if (row.blackPlayerId === viewerId) return { role: "player", color: "b" };
  if (row.whitePlayerId == null && row.blackPlayerId == null && (row.creatorId === viewerId || row.opponentId === viewerId)) {
    return { role: "player", color: null };
  }
  return isWatchableMode(row.mode) ? { role: "spectator" } : { role: "none" };
}

/** Live modes are watchable by members (owner Q3); bot games are private to their player. */
export function isWatchableMode(mode: string | null): boolean {
  return mode === "FRIEND" || mode === "ONLINE" || mode === "TOURNAMENT";
}

export function isBotMode(mode: string | null): boolean {
  return mode === "BOT" || mode === "LEGEND_BOT";
}

export function isFinishedStatus(status: string): boolean {
  return status === "COMPLETED" || status === "ABORTED" || status === "CANCELLED" || status === "EXPIRED";
}

/** logger.warn that never throws (the Sentry logger is absent in plain Node tests and scripts). */
export function warnSafe(message: string, context: Record<string, string | number | boolean | null | undefined>): void {
  try {
    logger.warn(message, context);
  } catch {
    // logging must never fail a request
  }
}
