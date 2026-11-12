// /games layout: noindex metadata, the gate (sign-in, membership, the `review-v3` flag) and the realtime boot.
//
// The redirects run HERE, outside the segment's loading.tsx Suspense boundary (P2 FIX-A, T17): a redirect() thrown
// by a page after its skeleton streamed crashes the dev router. RealtimeBoot gets a socket token minted in this render
// (client-data-layer 5.1), so the archive's live updates (games:changed, analysis:*) need no GET /api/socket-token.
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { serverBuildId } from "@/lib/api/context";
import { logger } from "@/lib/logger";
import { RealtimeBoot } from "@/lib/realtime/RealtimeBoot";
import type { SocketToken } from "@/lib/realtime/connection";
import { createMetadata } from "@/lib/seo";
import { entFromSessionClaims, mintSocketTokenForViewer, SocketTokenConfigError } from "@/lib/socket-token";
import { gamesGate } from "./gate";

export const metadata: Metadata = createMetadata({
  title: "My games",
  description: "Your finished games, each with a coach review.",
  path: "/games",
  noIndex: true,
});

async function mintToken(viewer: Awaited<ReturnType<typeof gamesGate>>): Promise<SocketToken | null> {
  try {
    const nowMs = Date.now();
    const { sessionClaims } = await auth();
    const ent = entFromSessionClaims((sessionClaims as { md?: unknown } | null)?.md, nowMs);
    const { token, expiresAt } = mintSocketTokenForViewer(viewer, { nowMs, ent });
    return { token, expiresAt };
  } catch (err) {
    if (!(err instanceof SocketTokenConfigError)) throw err;
    logger.error(`games layout: cannot mint a socket token (${err.message}); the client will fetch one`);
    return null;
  }
}

export default async function GamesLayout({ children }: { children: React.ReactNode }) {
  const viewer = await gamesGate();
  const token = await mintToken(viewer);
  return (
    <>
      <RealtimeBoot token={token} buildId={serverBuildId()} />
      {children}
    </>
  );
}
