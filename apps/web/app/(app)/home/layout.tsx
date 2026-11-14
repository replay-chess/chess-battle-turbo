// /home layout: noindex metadata, the gate (sign-in, membership, the `home` flag) and the realtime boot.
//
// The redirects run HERE, outside the segment's loading.tsx Suspense boundary (P2 FIX-A): a redirect() thrown by a page
// after its skeleton streamed crashes the dev router. RealtimeBoot gets a socket token minted in this render
// (client-data-layer 5.1), so Home's live rows (import progress, analysis, bank counts) need no GET /api/socket-token.
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { serverBuildId } from "@/lib/api/context";
import { logger } from "@/lib/logger";
import { RealtimeBoot } from "@/lib/realtime/RealtimeBoot";
import type { SocketToken } from "@/lib/realtime/connection";
import { createMetadata } from "@/lib/seo";
import { entFromSessionClaims, mintSocketTokenForViewer, SocketTokenConfigError } from "@/lib/socket-token";
import { homeGate } from "./gate";

export const metadata: Metadata = createMetadata({
  title: "Home",
  description: "Your next review, your Mistake Bank and your week.",
  path: "/home",
  noIndex: true,
});

async function mintToken(viewer: Awaited<ReturnType<typeof homeGate>>): Promise<SocketToken | null> {
  try {
    const nowMs = Date.now();
    const { sessionClaims } = await auth();
    const ent = entFromSessionClaims((sessionClaims as { md?: unknown } | null)?.md, nowMs);
    const { token, expiresAt } = mintSocketTokenForViewer(viewer, { nowMs, ent });
    return { token, expiresAt };
  } catch (err) {
    if (!(err instanceof SocketTokenConfigError)) throw err;
    logger.error(`home layout: cannot mint a socket token (${err.message}); the client will fetch one`);
    return null;
  }
}

export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const viewer = await homeGate();
  const token = await mintToken(viewer);
  return (
    <>
      <RealtimeBoot token={token} buildId={serverBuildId()} />
      {children}
    </>
  );
}
