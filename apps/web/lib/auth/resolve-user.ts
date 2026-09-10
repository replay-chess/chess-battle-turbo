import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

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

function tokenMatchesSecret(token: string | null, secret: string | undefined): boolean {
  if (!token || !secret) return false;
  const tokenBytes = Buffer.from(token);
  const secretBytes = Buffer.from(secret);
  if (tokenBytes.length !== secretBytes.length) return false;
  return timingSafeEqual(tokenBytes, secretBytes);
}

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
 *    body (or, for body-less GET polls, the `userReferenceId` query parameter)
 * 2. Internal service token — for WebSocket server (server-to-server), uses
 *    `x-internal-token` header + `userReferenceId` from body. Only honored on
 *    INTERNAL_ROUTE_PATHS; other routes skip straight to mode 3.
 * 3. Clerk session — for browser requests, local JWT verification + DB lookup
 */
export async function resolveUser(request: NextRequest): Promise<DbUser> {
  // Mode 1: Perf testing bypass
  if (process.env.PERF_AUTH_BYPASS === "true") {
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
