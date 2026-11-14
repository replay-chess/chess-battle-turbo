// The /train gate (phase-05 plan §7.9, §11): signed out → sign-in; not onboarded → onboarding; not a member → pricing
// (training is a member feature); `train` off → 404 (the screens do not exist for that viewer yet). Shared by the
// layout (its redirects run before any loading.tsx streams: P2 FIX-A, T17) and each page (soft navigations skip
// layouts); getViewer() and getFlags() are cache()'d, so the second call costs nothing. The return path is the full
// URL with its query (`x-rc-pathname` from middleware), so sign-in comes back to the same filters.
import "server-only";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { requireMemberPage } from "@/lib/auth/require-member-page";
import type { Viewer } from "@/lib/auth/viewer";
import { getFlags } from "@/lib/flags";
import { logger } from "@/lib/logger";
import type { SocketToken } from "@/lib/realtime/connection";
import { entFromSessionClaims, mintSocketTokenForViewer, SocketTokenConfigError } from "@/lib/socket-token";

export async function trainGate(): Promise<Viewer> {
  const viewer = await requireMemberPage();
  const flags = await getFlags(viewer);
  if (!flags.train) notFound();
  return viewer;
}

/**
 * A socket token minted in this render (client-data-layer 5.1), so the hub's and the bank's user-room listener
 * (`bank:due_changed`, `mistakes:added`, `analysis:*`) needs no GET /api/socket-token. Null when it cannot be minted
 * here: the client then fetches one on connect.
 */
export async function trainSocketToken(viewer: Viewer): Promise<SocketToken | null> {
  try {
    const nowMs = Date.now();
    const { sessionClaims } = await auth();
    const ent = entFromSessionClaims((sessionClaims as { md?: unknown } | null)?.md, nowMs);
    const { token, expiresAt } = mintSocketTokenForViewer(viewer, { nowMs, ent });
    return { token, expiresAt };
  } catch (err) {
    if (!(err instanceof SocketTokenConfigError)) throw err;
    logger.error(`train: cannot mint a socket token (${err.message}); the client will fetch one`);
    return null;
  }
}
