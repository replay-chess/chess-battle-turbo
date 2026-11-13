// /settings/connected layout: noindex metadata, the gate and the realtime boot (phase-04 plan §5.6: the page holds
// "user" for the `import:*` events). The gate runs HERE, outside loading.tsx's Suspense boundary, like /games (P2
// FIX-A). RealtimeBoot gets a socket token minted in this render, so no GET /api/socket-token is needed.
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { serverBuildId } from "@/lib/api/context";
import type { Viewer } from "@/lib/auth/viewer";
import { logger } from "@/lib/logger";
import { RealtimeBoot } from "@/lib/realtime/RealtimeBoot";
import type { SocketToken } from "@/lib/realtime/connection";
import { createMetadata } from "@/lib/seo";
import { entFromSessionClaims, mintSocketTokenForViewer, SocketTokenConfigError } from "@/lib/socket-token";
import { CONNECTED_PATH, connectedGate } from "./gate";

export const metadata: Metadata = createMetadata({
  title: "Connected accounts",
  description: "Link Chess.com and Lichess to import your games for review.",
  path: CONNECTED_PATH,
  noIndex: true,
});

async function mintToken(viewer: Viewer): Promise<SocketToken | null> {
  try {
    const nowMs = Date.now();
    const { sessionClaims } = await auth();
    const ent = entFromSessionClaims((sessionClaims as { md?: unknown } | null)?.md, nowMs);
    const { token, expiresAt } = mintSocketTokenForViewer(viewer, { nowMs, ent });
    return { token, expiresAt };
  } catch (err) {
    if (!(err instanceof SocketTokenConfigError)) throw err;
    logger.error(`settings/connected layout: cannot mint a socket token (${err.message}); the client will fetch one`);
    return null;
  }
}

export default async function ConnectedLayout({ children }: { children: React.ReactNode }) {
  const viewer = await connectedGate();
  const token = await mintToken(viewer);
  return (
    <>
      <RealtimeBoot token={token} buildId={serverBuildId()} />
      {children}
    </>
  );
}
