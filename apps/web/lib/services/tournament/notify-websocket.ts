import { logger } from "@/lib/logger";
import { InternalFetchConfigError, internalFetch } from "@/lib/internal/fetch";

// Tournament lobby events → the socket server's `/internal/tournament-event` (plan §7.5 #5, AS F-06; phase-02
// plan §7.5.1). Signed with internalFetch() (HMAC x-rc-kid/x-rc-ts/x-rc-sig, kid `web`); the static
// `x-internal-token` is no longer sent. Callers run this inside `after()` so it never delays the response and
// Vercel keeps the function alive until it finishes (AA F-10). Removed with the legacy lobby in P12.

interface TournamentEvent {
  event: "game_ended" | "game_started" | "tournament_started" | "tournament_ended" | "player_joined";
  tournamentReferenceId: string;
  data?: Record<string, unknown>;
}

/** Never throws: a failed notification only costs the lobby a live update. */
export async function notifyTournamentEvent({ event, tournamentReferenceId, data }: TournamentEvent): Promise<void> {
  try {
    const response = await internalFetch("/internal/tournament-event", {
      body: { event, tournamentReferenceId, data },
    });
    if (!response.ok) {
      logger.warn("Socket server refused the tournament event", { event, status: response.status });
    }
  } catch (error) {
    if (error instanceof InternalFetchConfigError) {
      logger.warn(`Tournament event not sent: ${error.message}`, { event });
      return;
    }
    logger.error(`Failed to notify WS of tournament event: ${event}`, error);
  }
}
