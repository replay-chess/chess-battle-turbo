import { defineEndpoint } from "../endpoint";
import {
  CheckpointBody,
  CompleteBody,
  CompleteResponse,
  GameCreateBody,
  GameCreateResponse,
  GameDetailResponse,
  GameRefParams,
  PgnText,
} from "../games";

/** Phase-02 plan §7.1. Handlers: WEB/app/api/games/** (WP-E). */
export const gamesEndpoints = {
  /** §7.1.1. Creates a bot game; replaces POST /api/chess/create-ai-game. Requires an Idempotency-Key (UUID v4). */
  create: defineEndpoint({
    id: "games.create",
    method: "POST",
    path: "/api/games",
    auth: "member",
    class: "W2",
    cache: "no-store",
    rateLimit: { bucket: "create-game", limit: 20, windowSec: 600, by: "user", store: "durable" },
    body: GameCreateBody,
    response: GameCreateResponse,
    status: 201,
    errors: ["not_found", "in_flight", "illegal_position", "idempotency_key_reused"],
    maxBodyBytes: 4_096,
    summary: "Creates a bot game",
  }),
  /**
   * §7.1.2. Role-aware snapshot, the same function the RSC calls. Live games answer no-store from the handler.
   * `auth: "user"`: the handler answers 402 itself, so a lapsed member who plays an IN_PROGRESS game can still
   * load it (plan 11.1); everyone else needs membership.
   */
  detail: defineEndpoint({
    id: "games.detail",
    method: "GET",
    path: "/api/games/{ref}",
    auth: "user",
    errors: ["subscription_required"],
    class: "R1",
    cache: "private-etag",
    params: GameRefParams,
    response: GameDetailResponse,
    summary: "A game snapshot for a player or a spectator",
  }),
  /** §7.1.3. Bot-game journal checkpoint (also sent with sendBeacon as text/plain). Membership is not re-checked. */
  checkpoint: defineEndpoint({
    id: "games.checkpoint",
    method: "POST",
    path: "/api/games/{ref}/checkpoint",
    auth: "user",
    class: "W1",
    cache: "no-store",
    rateLimit: { bucket: "bot-checkpoint", limit: 60, windowSec: 60, by: "user" },
    params: GameRefParams,
    body: CheckpointBody,
    status: 204,
    errors: ["forbidden", "conflict", "illegal_moves"],
    maxBodyBytes: 8_192,
    summary: "Saves a bot game's moves",
  }),
  /** §7.1.4. Finishes a bot game; the server adjudicates the claimed result. */
  complete: defineEndpoint({
    id: "games.complete",
    method: "POST",
    path: "/api/games/{ref}/complete",
    auth: "user",
    class: "W2",
    cache: "no-store",
    params: GameRefParams,
    body: CompleteBody,
    response: CompleteResponse,
    errors: ["forbidden", "conflict", "illegal_moves"],
    maxBodyBytes: 16_384,
    summary: "Finishes a bot game",
  }),
  /** §7.1.5. PGN download (players only); 409 conflict {reason: not_finished} while live. */
  pgn: defineEndpoint({
    id: "games.pgn",
    method: "GET",
    path: "/api/games/{ref}/pgn",
    auth: "member",
    class: "R1",
    cache: "no-store",
    params: GameRefParams,
    response: PgnText,
    responseFormat: "text",
    errors: ["conflict"],
    summary: "Downloads a finished game as PGN",
  }),
} as const;
