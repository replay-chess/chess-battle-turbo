// Endpoint paths for api() (plan §7.12). The one place a client path is written.
//
// The client imports registry *types* only (no zod at runtime): each path is a string literal that must equal the
// registry entry's `path` type, so renaming a path in `@repo/contracts/http/registry` fails type-checking here,
// and endpoints.test.ts checks the same thing at runtime. A path with `{param}` segments becomes a function.
import type { EndpointById, EndpointId } from "@repo/contracts/http/registry";

type PathOf<I extends EndpointId> = EndpointById<I>["path"];

type EndpointPaths = {
  me: PathOf<"me.get">;
  openings: PathOf<"catalog.openings.index">;
  billingRefresh: PathOf<"billing.refresh">;
  sessionClear: PathOf<"session.clear">;
  health: PathOf<"health.get">;
  socketToken: PathOf<"socket-token.get">;
  subscription: PathOf<"subscription.get">;
  // P2 games (`{ref}` filled by lib/api/queries/games.ts gamePath()).
  gameCreate: PathOf<"games.create">;
  gameDetail: PathOf<"games.detail">;
  gameCheckpoint: PathOf<"games.checkpoint">;
  gameComplete: PathOf<"games.complete">;
  gamePgn: PathOf<"games.pgn">;
};

export const endpoints = {
  me: "/api/me",
  openings: "/api/openings",
  billingRefresh: "/api/billing/refresh",
  sessionClear: "/api/session/clear",
  health: "/api/health",
  socketToken: "/api/socket-token",
  subscription: "/api/subscription",
  gameCreate: "/api/games",
  gameDetail: "/api/games/{ref}",
  gameCheckpoint: "/api/games/{ref}/checkpoint",
  gameComplete: "/api/games/{ref}/complete",
  gamePgn: "/api/games/{ref}/pgn",
} as const satisfies EndpointPaths;

/** The registry id behind each entry (endpoints.test.ts). */
export const ENDPOINT_IDS = {
  me: "me.get",
  openings: "catalog.openings.index",
  billingRefresh: "billing.refresh",
  sessionClear: "session.clear",
  health: "health.get",
  socketToken: "socket-token.get",
  subscription: "subscription.get",
  gameCreate: "games.create",
  gameDetail: "games.detail",
  gameCheckpoint: "games.checkpoint",
  gameComplete: "games.complete",
  gamePgn: "games.pgn",
} as const satisfies Record<keyof typeof endpoints, EndpointId>;
