import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

type DbUser = Awaited<ReturnType<typeof prisma.user.findUnique>>;

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

/**
 * Verify the request has a valid internal service token (WebSocket server → Next.js API).
 * Returns true if the token matches, false otherwise.
 */
export function isInternalServiceRequest(request: NextRequest): boolean {
  const internalToken = request.headers.get("x-internal-token");
  return !!(internalToken && INTERNAL_API_SECRET && internalToken === INTERNAL_API_SECRET);
}

/**
 * Resolve the authenticated DB user from a request.
 *
 * Supports three auth modes (checked in order):
 * 1. PERF_AUTH_BYPASS — for k6 perf testing, trusts `userReferenceId` from body
 * 2. Internal service token — for WebSocket server (server-to-server), uses
 *    `x-internal-token` header + `userReferenceId` from body
 * 3. Clerk session — for browser requests, local JWT verification + DB lookup
 */
export async function resolveUser(request: NextRequest): Promise<DbUser> {
  // Mode 1: Perf testing bypass
  if (process.env.PERF_AUTH_BYPASS === "true") {
    const body = await request.clone().json();
    if (body.userReferenceId) {
      return prisma.user.findUnique({ where: { referenceId: body.userReferenceId } });
    }
  }

  // Mode 2: Internal service-to-service auth (WebSocket server → Next.js API)
  if (isInternalServiceRequest(request)) {
    const body = await request.clone().json();
    if (body.userReferenceId) {
      return prisma.user.findUnique({ where: { referenceId: body.userReferenceId } });
    }
  }

  // Mode 3: Clerk session auth (browser requests)
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return null;

  return prisma.user.findUnique({ where: { googleId: clerkUserId } });
}
