import { logger } from "@/lib/logger";

// Tournament lobby events → the socket server's `/internal/tournament-event` (plan §7.5 #5,
// AS F-06). The socket checks `x-internal-token` against INTERNAL_API_SECRET in constant time.
// Callers run this inside `after()` so it never delays the response and Vercel keeps the
// function alive until it finishes (AA F-10).

const WS_URL = process.env.NEXT_PUBLIC_WEBSOCKET_URL || "http://localhost:3002";

interface TournamentEvent {
  event: "game_ended" | "game_started" | "tournament_started" | "tournament_ended" | "player_joined";
  tournamentReferenceId: string;
  data?: Record<string, unknown>;
}

/** Never throws: a failed notification only costs the lobby a live update. */
export async function notifyTournamentEvent({ event, tournamentReferenceId, data }: TournamentEvent): Promise<void> {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    logger.warn("INTERNAL_API_SECRET is not set; tournament event not sent", { event });
    return;
  }
  try {
    const url = `${WS_URL.replace("ws://", "http://").replace("wss://", "https://")}/internal/tournament-event`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": secret },
      body: JSON.stringify({ event, tournamentReferenceId, data }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      logger.warn("Socket server refused the tournament event", { event, status: response.status });
    }
  } catch (error) {
    logger.error(`Failed to notify WS of tournament event: ${event}`, error);
  }
}
