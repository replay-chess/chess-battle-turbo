import type { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "./error-response";

export type AdminUser = { id: bigint; referenceId: string; role: "ADMIN" };

export type RequireAdminResult =
  | { error: NextResponse; user: null }
  | { error: null; user: AdminUser };

/**
 * Admin guard for legacy route handlers (plan §3.2 H1, AA F-01, F-23). Call it as the
 * first statement of the handler, before reading the body.
 *
 * Identity comes from the Clerk session (`auth()`, local JWT verification) and the DB row
 * by `googleId`; there is no Clerk Backend API call and no lookup by email.
 * - no session, no row, or an inactive row → 401 `unauthorized`
 * - signed in but `role !== "ADMIN"` → 403 `forbidden`
 */
export async function requireAdmin(): Promise<RequireAdminResult> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return { error: errorResponse("unauthorized", "Sign in to continue."), user: null };
  }

  const user = await prisma.user.findUnique({
    where: { googleId: clerkUserId },
    select: { id: true, referenceId: true, role: true, isActive: true },
  });

  if (!user || !user.isActive) {
    return { error: errorResponse("unauthorized", "Sign in to continue."), user: null };
  }

  if (user.role !== "ADMIN") {
    return { error: errorResponse("forbidden", "You don't have access to this."), user: null };
  }

  return { error: null, user: { id: user.id, referenceId: user.referenceId, role: "ADMIN" } };
}
