// GET /api/socket-token (plan §7.4 A5). Issues the short-lived token the browser passes to the WebSocket server in
// the socket.io `auth` handshake. Body `{ data: { token, expiresAt } }` plus a top-level `token`/`expiresAt` mirror
// for one release (old bundles read the bare shape). expiresAt is unix seconds (lib/socket-token.ts).
import { realtimeEndpoints } from "@repo/contracts/http/registry";
import { ApiError } from "@/lib/api/api-error";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { logger } from "@/lib/logger";
import { signSocketToken } from "@/lib/socket-token";

export const dynamic = "force-dynamic";

export const GET = route(realtimeEndpoints.socketToken, async (ctx) => {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    logger.error(
      "GET /api/socket-token: INTERNAL_API_SECRET is not set; cannot sign socket tokens. " +
        "Set the same value in apps/web and apps/web-socket.",
    );
    throw new ApiError("not_configured", { message: "Socket auth is not configured." });
  }
  // auth "user": route() answered 401 already when there is no viewer.
  const { token, expiresAt } = signSocketToken({ userReferenceId: ctx.viewer!.ref, secret });
  return respondWith({ token, expiresAt }, { legacyMirror: { token, expiresAt } });
});
