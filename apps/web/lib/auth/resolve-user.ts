import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { testHooksEnabled } from "@/lib/env-server";
import { isPerfBypassRequest, tokenMatchesSecret } from "@/lib/auth/secrets";

// Shared with require-subscription.ts; kept importable from here for existing callers.
export { isPerfBypassRequest };
import { errorResponse, requestIdOf } from "@/lib/auth/error-response";

type DbUser = Awaited<ReturnType<typeof prisma.user.findUnique>>;

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

/**
 * The only routes on which the internal service token is honored.
 *
 * These are exactly the endpoints the WebSocket server calls with
 * `x-internal-token` (see apps/web-socket/utils/apiClient.ts: persistMove,
 * completeGame, updateGameState). The token lets the caller act as any user
 * (`userReferenceId` from the body) and bypasses the paywall, so it must not be
 * accepted anywhere else: a leaked token could otherwise create games, enqueue
 * matchmaking, or join tournaments for arbitrary users without a subscription.
 * Every other route ignores the header and falls through to Clerk auth.
 */
export const INTERNAL_ROUTE_PATHS: ReadonlySet<string> = new Set([
  "/api/chess/move",
  "/api/chess/game-over",
  "/api/chess/game-state",
]);

/** True when `pathname` is one of the socket-server routes in INTERNAL_ROUTE_PATHS. */
export function isInternalRoutePath(pathname: string): boolean {
  const normalized =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return INTERNAL_ROUTE_PATHS.has(normalized);
}

// Startup report: a switched-on bypass is loud in dev and an error where it is ignored.
function reportPerfBypass(env: Readonly<Record<string, string | undefined>> = process.env): void {
  if (env.PERF_AUTH_BYPASS !== "true") return;
  if (!testHooksEnabled(env)) {
    logger.error("PERF_AUTH_BYPASS is set but test hooks are off; the bypass is ignored");
  } else if (!env.PERF_TOKEN) {
    logger.error("PERF_AUTH_BYPASS is set without PERF_TOKEN; the bypass is ignored");
  } else {
    logger.warn("PERF_AUTH_BYPASS is on: requests with a valid x-perf-token act as any user");
  }
}
reportPerfBypass();

/**
 * Verify the request has a valid internal service token (WebSocket server → Next.js API).
 * Returns true only when the token matches AND the request targets one of the
 * INTERNAL_ROUTE_PATHS; on any other route the header is ignored.
 */
export function isInternalServiceRequest(request: NextRequest): boolean {
  if (!isInternalRoutePath(request.nextUrl.pathname)) return false;
  return tokenMatchesSecret(request.headers.get("x-internal-token"), INTERNAL_API_SECRET);
}

/**
 * Guard for the socket-server-only routes (plan §3.2 H2, AA F-02): `move`, `game-over`,
 * `game-state`. Returns null for a valid internal request; otherwise the error to send:
 * 401 `unauthorized` without a Clerk session, 403 `forbidden` for a signed-in browser.
 */
export async function requireInternalRequest(request: NextRequest): Promise<NextResponse | null> {
  if (isInternalServiceRequest(request)) return null;
  const requestId = requestIdOf(request);
  const { userId } = await auth();
  if (userId) {
    return errorResponse("forbidden", "This endpoint is only for the game server.", { requestId });
  }
  return errorResponse("unauthorized", "Sign in to continue.", { requestId });
}

/**
 * Read `userReferenceId` from a JSON body without throwing on requests that have
 * no body or a non-JSON body (GET polls, sendBeacon form posts).
 */
async function readBodyReferenceId(request: NextRequest): Promise<string | null> {
  try {
    const body: unknown = await request.clone().json();
    if (body && typeof body === "object" && "userReferenceId" in body) {
      const value = (body as { userReferenceId?: unknown }).userReferenceId;
      if (typeof value === "string" && value.length > 0) return value;
    }
  } catch {
    // No JSON body — fall through to the other auth modes.
  }
  return null;
}

/**
 * Resolve the authenticated DB user from a request.
 *
 * Supports three auth modes (checked in order):
 * 1. PERF_AUTH_BYPASS — for k6 perf testing, trusts `userReferenceId` from the
 *    body (or, for body-less GET polls, the `userReferenceId` query parameter).
 *    Only when `isPerfBypassRequest()` holds (test hooks on + `x-perf-token`).
 * 2. Internal service token — for WebSocket server (server-to-server), uses
 *    `x-internal-token` header + `userReferenceId` from body. Only honored on
 *    INTERNAL_ROUTE_PATHS; other routes skip straight to mode 3.
 * 3. Clerk session — for browser requests, local JWT verification + DB lookup
 */
export async function resolveUser(request: NextRequest): Promise<DbUser> {
  // Mode 1: Perf testing bypass
  if (isPerfBypassRequest(request)) {
    const referenceId =
      (await readBodyReferenceId(request)) ??
      request.nextUrl.searchParams.get("userReferenceId");
    if (referenceId) {
      return prisma.user.findUnique({ where: { referenceId } });
    }
  }

  // Mode 2: Internal service-to-service auth (WebSocket server → Next.js API)
  if (isInternalServiceRequest(request)) {
    const referenceId = await readBodyReferenceId(request);
    if (referenceId) {
      return prisma.user.findUnique({ where: { referenceId } });
    }
  }

  // Mode 3: Clerk session auth (browser requests)
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return null;

  return prisma.user.findUnique({ where: { googleId: clerkUserId } });
}
