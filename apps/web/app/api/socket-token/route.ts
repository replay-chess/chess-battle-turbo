import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolve-user";
import { signSocketToken } from "@/lib/socket-token";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Issues a short-lived token the browser passes to the WebSocket server in the
 * socket.io `auth` handshake so the server can tie the socket to a user.
 *
 * Auth goes through `resolveUser` (Clerk session, or the perf bypass for k6
 * runs). The internal service token is not honoured here since this is not
 * one of the socket-server routes.
 */
export async function GET(request: NextRequest) {
  const user = await resolveUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    logger.error(
      "GET /api/socket-token: INTERNAL_API_SECRET is not set; cannot sign socket tokens. " +
        "Set the same value in apps/web and apps/web-socket.",
    );
    return NextResponse.json({ error: "Socket auth is not configured" }, { status: 500 });
  }

  const { token, expiresAt } = signSocketToken({ userReferenceId: user.referenceId, secret });

  return NextResponse.json(
    { token, expiresAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
