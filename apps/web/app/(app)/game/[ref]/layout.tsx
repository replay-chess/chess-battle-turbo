// /game/[ref] layout: noindex metadata and the realtime boot with a token minted in this render (P2 plan 5.1,
// client-data-layer 5.1), so the first socket connect needs no GET /api/socket-token. RealtimeBoot never connects
// by itself; the game screen's "game" hold does. Bot games never acquire it, so they open no socket.
//
// The sign-in and membership redirects run HERE, before anything renders (FIX-A, T17: a redirect() thrown by the page
// after a loading.tsx skeleton had streamed redirected on the client during hydration, which crashed Next's app router
// in dev and never reached /pricing). From the layout the response is a plain 307. The page keeps the same checks
// (cached, no extra query). The segment has no loading.tsx any more: the screen is in the document's shell
// (features/game/screen/GameScreen.tsx).
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { createMetadata } from "@/lib/seo";
import { serverBuildId } from "@/lib/api/context";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { pageGateRedirect } from "@/lib/auth/guards";
import { getGameSnapshot } from "@/lib/games/snapshot.server";
import { logger } from "@/lib/logger";
import { entFromSessionClaims, mintSocketTokenForViewer, SocketTokenConfigError } from "@/lib/socket-token";
import { RealtimeBoot } from "@/lib/realtime/RealtimeBoot";
import type { SocketToken } from "@/lib/realtime/connection";

export const metadata: Metadata = createMetadata({
  title: "Game",
  description: "Live chess game on Replay Chess.",
  path: "/game",
  noIndex: true,
});

async function mintToken(): Promise<SocketToken | null> {
  const viewer = await getViewer();
  if (!viewer) return null;
  try {
    const nowMs = Date.now();
    const { sessionClaims } = await auth();
    const ent = entFromSessionClaims((sessionClaims as { md?: unknown } | null)?.md, nowMs);
    const { token, expiresAt } = mintSocketTokenForViewer(viewer, { nowMs, ent });
    return { token, expiresAt };
  } catch (err) {
    if (!(err instanceof SocketTokenConfigError)) throw err;
    logger.error(`game layout: cannot mint a socket token (${err.message}); the client will fetch one`);
    return null;
  }
}

/** The page's redirects (sign-in, membership), before anything streams. Same rules as page.tsx. */
async function gate(ref: string): Promise<void> {
  const returnTo = `/game/${ref}`;
  const viewer = await getViewer();
  if (!viewer) redirect(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`);
  const target = pageGateRedirect(viewer, { returnTo });
  if (!target) return;
  // A player of an IN_PROGRESS game whose membership lapsed mid-game may finish it (plan 4.7, 11). getGameSnapshot is
  // React cache()'d, so the page reuses this read.
  const snapshot = await getGameSnapshot(ref, viewer);
  const lapsedLivePlayer = !!snapshot && snapshot.you.role === "player" && snapshot.status === "IN_PROGRESS";
  if (!(lapsedLivePlayer && viewer.user.onboarded)) redirect(target);
}

export default async function GameLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ ref: string }>;
}) {
  await gate((await params).ref);
  const token = await mintToken();
  return (
    <>
      <RealtimeBoot token={token} buildId={serverBuildId()} />
      {children}
    </>
  );
}
