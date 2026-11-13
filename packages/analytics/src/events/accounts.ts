// Account events (phase-04 plan §10.1). Server events of the accounts routes (WP-C: sent by posthog-node inside
// `after()`; apps/web/lib/accounts/telemetry.ts validates against these schemas first and drops anything else) and the
// client events of /settings/connected (WP-G: apps/web/components/accounts/telemetry.ts). Closed property sets:
// providers, contexts, buckets, booleans and the board state; never a username, handle or email.
//
// Supersedes handbacks/wp-c-analytics-accounts.ts (same server events, plus `accountsClientEvents`).
import { z } from "zod";

const provider = z.enum(["chesscom", "lichess"]);
const context = z.enum(["onboarding", "settings"]);
/** `0`, `1-49`, `50-499`, `500+`, or `unknown` when the provider reports no total. */
const countBucket = z.enum(["0", "1-49", "50-499", "500+", "unknown"]);
/** The V4SettingsConnected / V4SettingsConnectedError board enum (apps/web/components/accounts/model.ts BOARD_STATES). */
export const CONNECTED_BOARD_STATES = [
  "default",
  "syncing",
  "sync_failed",
  "rate_limited",
  "not_found",
  "private_games",
  "li_connecting",
  "li_denied",
  "both_linked",
  "none_linked",
] as const;

export const accountsServerEvents = {
  account_linked: z
    .object({ provider, context, is_verified: z.boolean(), total_rated_games_bucket: countBucket })
    .strict(),
  account_unlinked: z.object({ provider, has_delete_games: z.boolean(), games_count_bucket: countBucket }).strict(),
  account_lookup_fallback_used: z
    .object({ upstream_status: z.union([z.literal(429), z.literal(403)]), result: z.enum(["found", "private", "not_found"]) })
    .strict(),
} as const;

export const accountsClientEvents = {
  settings_connected_viewed: z.object({ state: z.enum(CONNECTED_BOARD_STATES) }).strict(),
  account_link_started: z.object({ provider, context }).strict(),
  account_sync_requested: z.object({ provider }).strict(),
  account_sync_rate_limited: z.object({ provider }).strict(),
  account_autoimport_toggled: z.object({ provider, is_on: z.boolean() }).strict(),
  account_unlink_confirmed: z.object({ provider, has_delete_games: z.boolean() }).strict(),
  lichess_oauth_denied: z.object({ context }).strict(),
} as const;

export const accountsEvents = { ...accountsServerEvents, ...accountsClientEvents } as const;
