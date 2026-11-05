// Internal (service-to-service) auth for route({ auth: "internal" }) (plan §7.2 step 3, P1-21).
//
// P1 keeps today's scheme: `x-internal-token` compared timing-safe with INTERNAL_API_SECRET, honoured only on the
// endpoint ids listed here. Whether P2 replaces it with HMAC is owner decision Q-18; changing the scheme changes
// this one function. P1 adds no internal-auth env var.
//
// The legacy (not yet route()) socket routes still use lib/auth/resolve-user.ts's INTERNAL_ROUTE_PATHS, which lists
// the same three paths; both lists go when those routes move onto route() (P2).
import { tokenMatchesSecret } from "./secrets";

export const INTERNAL_TOKEN_HEADER = "x-internal-token";

/**
 * Endpoint ids on which the internal token is honoured. The socket server's callers (apps/web-socket/utils/
 * apiClient.ts: persistMove, completeGame, updateGameState) and the participant read of game-by-ref. A leaked token
 * must not work anywhere else, so an id outside this set is refused even with a valid token.
 */
export const INTERNAL_ROUTE_IDS: ReadonlySet<string> = new Set([
  "chess.move",
  "chess.game-over",
  "chess.game-state",
  "chess.game-by-ref",
]);

type Env = Readonly<Record<string, string | undefined>>;

/** True when the request carries the internal token AND the endpoint is one the token may call. */
export function verifyInternalRequest(
  req: { headers: Pick<Headers, "get"> },
  routeId: string,
  env: Env = process.env,
): boolean {
  if (!INTERNAL_ROUTE_IDS.has(routeId)) return false;
  return tokenMatchesSecret(req.headers.get(INTERNAL_TOKEN_HEADER), env.INTERNAL_API_SECRET);
}
