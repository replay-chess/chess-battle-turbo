// GET /api/socket-token (phase-02 plan §7.1.7). Issues the short-lived v2 token the browser passes to the socket
// server in the socket.io `auth` handshake: claims {v: 2, sub, iat, exp, env, ent, role, name, kid} signed with
// SOCKET_TOKEN_SECRET (lib/socket-token.ts). Any signed-in user gets one (P4's activation screen needs the `user:`
// room before entitlement); `ent` = 0 for a non-member. The viewer is already loaded by route(), so minting adds no
// statement. Body `{ data: { token, expiresAt } }` plus the top-level legacy mirror for one release; expiresAt is
// unix seconds.
import { realtimeEndpoints } from "@repo/contracts/http/registry";
import { ApiError } from "@/lib/api/api-error";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { logger } from "@/lib/logger";
import { SocketTokenConfigError, mintSocketTokenForViewer } from "@/lib/socket-token";

export const dynamic = "force-dynamic";

export const GET = route(realtimeEndpoints.socketToken, async (ctx) => {
  try {
    // auth "user": route() answered 401 already when there is no viewer.
    // Without SOCKET_TOKEN_SECRET, dev/test/local sign with the old shared secret (lib/socket-token.ts); production 503s.
    const { token, expiresAt } = mintSocketTokenForViewer(ctx.viewer!, { nowMs: ctx.now.getTime() });
    return respondWith({ token, expiresAt }, { legacyMirror: { token, expiresAt } });
  } catch (err) {
    if (!(err instanceof SocketTokenConfigError)) throw err;
    logger.error(`GET /api/socket-token: ${err.message}. Set SOCKET_TOKEN_SECRET in apps/web and the socket server.`);
    throw new ApiError("not_configured", { message: "Socket auth is not configured." });
  }
});
