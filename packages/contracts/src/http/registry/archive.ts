import { defineEndpoint } from "../endpoint";
import { GamesListResponse, GamesQuery } from "../games";

/**
 * Phase-03 plan §7.2 G1 (§5.10, §9.3; P3-D25, P3-D27). Handler: WEB/app/api/me/games/route.ts (WP-D).
 *
 * `auth: "user"` and the handler answers 402 (`requireReviewReader`, the review reads' pattern): with the flag
 * `review-lapsed-read` on a lapsed member may still list their games (B26), with it off the answer equals
 * `auth: "member"`. Keyset pages over `game_players."endedAt"`; page 1 and `limit=0` carry `meta.filteredTotal` and
 * `meta.counts`. The strong ETag is `g<users.gamesVersion>-<hash>`, so a revalidation costs no statement beyond the
 * viewer.
 */
export const archiveEndpoints = {
  list: defineEndpoint({
    id: "me.games",
    method: "GET",
    path: "/api/me/games",
    auth: "user",
    class: "R2",
    cache: "private-etag",
    query: GamesQuery,
    response: GamesListResponse,
    errors: ["subscription_required"],
    summary: "The viewer's finished games, newest first (keyset pages)",
  }),
} as const;
