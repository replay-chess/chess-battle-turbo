import assert from "node:assert/strict";
import { it } from "node:test";
import { CONNECTED_BOARD_STATES, accountsClientEvents, accountsEvents, accountsServerEvents } from "./accounts";

it("account server events: closed property sets, no usernames", () => {
  assert.ok(accountsServerEvents.account_linked.safeParse({ provider: "chesscom", context: "settings", is_verified: false, total_rated_games_bucket: "500+" }).success);
  assert.equal(accountsServerEvents.account_linked.safeParse({ provider: "chesscom", context: "settings", is_verified: false, total_rated_games_bucket: "500+", username: "x" }).success, false);
  assert.ok(accountsServerEvents.account_unlinked.safeParse({ provider: "lichess", has_delete_games: true, games_count_bucket: "unknown" }).success);
  assert.ok(accountsServerEvents.account_lookup_fallback_used.safeParse({ upstream_status: 403, result: "not_found" }).success);
  assert.equal(accountsServerEvents.account_lookup_fallback_used.safeParse({ upstream_status: 500, result: "found" }).success, false);
});

it("account client events: the ten board states, providers and contexts only", () => {
  assert.equal(CONNECTED_BOARD_STATES.length, 10);
  for (const state of CONNECTED_BOARD_STATES) assert.ok(accountsClientEvents.settings_connected_viewed.safeParse({ state }).success, state);
  assert.equal(accountsClientEvents.settings_connected_viewed.safeParse({ state: "looking" }).success, false);
  assert.ok(accountsClientEvents.account_link_started.safeParse({ provider: "lichess", context: "settings" }).success);
  assert.equal(accountsClientEvents.account_link_started.safeParse({ provider: "lichess", context: "settings", username: "x" }).success, false);
  assert.ok(accountsClientEvents.account_sync_requested.safeParse({ provider: "chesscom" }).success);
  assert.ok(accountsClientEvents.account_sync_rate_limited.safeParse({ provider: "lichess" }).success);
  assert.ok(accountsClientEvents.account_autoimport_toggled.safeParse({ provider: "chesscom", is_on: false }).success);
  assert.ok(accountsClientEvents.account_unlink_confirmed.safeParse({ provider: "chesscom", has_delete_games: true }).success);
  assert.ok(accountsClientEvents.lichess_oauth_denied.safeParse({ context: "onboarding" }).success);
  assert.equal(accountsClientEvents.lichess_oauth_denied.safeParse({ context: "home" }).success, false);
  assert.equal(Object.keys(accountsEvents).length, 10);
});
