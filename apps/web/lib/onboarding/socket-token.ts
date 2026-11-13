// The socket token of the onboarding steps that hold the realtime connection (phase-04 plan §5.6, §9.6): Activating
// ("activation" + "user" holds) and Done ("user"). Minted in the page's server render (no GET /api/socket-token);
// the steps render <RealtimeBoot> with it before their live content, so the connection exists when their effects
// subscribe. Welcome, Link, Confirm, Level, Goals and Plan never boot it (no socket.io-client in their chunks).
// Server only (Clerk session claims, the signing secret).
import { auth } from "@clerk/nextjs/server";
import type { Viewer } from "@/lib/auth/viewer";
import { logger } from "@/lib/logger";
import type { SocketToken } from "@/lib/realtime/connection";
import { entFromSessionClaims, mintSocketTokenForViewer, SocketTokenConfigError } from "@/lib/socket-token";

/** The viewer's socket token, or null when it cannot be minted here (the client then fetches one on connect). */
export async function mintOnboardingSocketToken(viewer: Viewer, nowMs: number = Date.now()): Promise<SocketToken | null> {
  try {
    const { sessionClaims } = await auth();
    const ent = entFromSessionClaims((sessionClaims as { md?: unknown } | null)?.md, nowMs);
    const { token, expiresAt } = mintSocketTokenForViewer(viewer, { nowMs, ent });
    return { token, expiresAt };
  } catch (err) {
    if (!(err instanceof SocketTokenConfigError)) throw err;
    logger.error(`onboarding: cannot mint a socket token (${err.message}); the client will fetch one`);
    return null;
  }
}
