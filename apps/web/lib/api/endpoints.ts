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
  // P3 review (`{ref}` / `{ply}` filled with fillPath()).
  review: PathOf<"review.get">;
  reviewStatus: PathOf<"review.status">;
  reviewAnalyse: PathOf<"review.analyse">;
  reviewRetry: PathOf<"review.retry">;
  reviewProgress: PathOf<"review.progress">;
  reviewMoment: PathOf<"review.moment">;
  reviewComplete: PathOf<"review.complete">;
  reviewPgn: PathOf<"review.pgn">;
  reviewLegend: PathOf<"review.legend">;
  reviewLegendCompute: PathOf<"review.legend.compute">;
  // P3 share (A10 `{ref}`, A11 `{code}`), archive (G1) and practice (PR1).
  shareCreate: PathOf<"share.create">;
  share: PathOf<"share.update">;
  meGames: PathOf<"me.games">;
  practiceContext: PathOf<"practice.context">;
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
  review: "/api/review/{ref}",
  reviewStatus: "/api/review/{ref}/status",
  reviewAnalyse: "/api/review/{ref}/analyse",
  reviewRetry: "/api/review/{ref}/retry",
  reviewProgress: "/api/review/{ref}/progress",
  reviewMoment: "/api/review/{ref}/moments/{ply}",
  reviewComplete: "/api/review/{ref}/complete",
  reviewPgn: "/api/review/{ref}/pgn",
  reviewLegend: "/api/review/{ref}/legend",
  reviewLegendCompute: "/api/review/{ref}/legend/compute",
  shareCreate: "/api/review/{ref}/share",
  share: "/api/share/{code}",
  meGames: "/api/me/games",
  practiceContext: "/api/practice/context",
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
  review: "review.get",
  reviewStatus: "review.status",
  reviewAnalyse: "review.analyse",
  reviewRetry: "review.retry",
  reviewProgress: "review.progress",
  reviewMoment: "review.moment",
  reviewComplete: "review.complete",
  reviewPgn: "review.pgn",
  reviewLegend: "review.legend",
  reviewLegendCompute: "review.legend.compute",
  shareCreate: "share.create",
  share: "share.update",
  meGames: "me.games",
  practiceContext: "practice.context",
} as const satisfies Record<keyof typeof endpoints, EndpointId>;
