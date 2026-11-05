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
};

export const endpoints = {
  me: "/api/me",
  openings: "/api/openings",
  billingRefresh: "/api/billing/refresh",
  sessionClear: "/api/session/clear",
  health: "/api/health",
  socketToken: "/api/socket-token",
  subscription: "/api/subscription",
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
} as const satisfies Record<keyof typeof endpoints, EndpointId>;
