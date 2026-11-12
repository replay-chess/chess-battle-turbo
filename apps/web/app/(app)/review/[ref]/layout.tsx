// /review/[ref] layout (phase-03 plan §4.1, §5.2; interface-check §4): the sign-in, membership and flag redirects run
// HERE, outside the segment's loading.tsx Suspense boundary, as P2's game layout does (FIX-A, T17: a redirect() from
// the page after loading.tsx streamed crashed the dev router). It also mounts RealtimeBoot with a socket token minted
// in this render, so the review's "review" hold connects without a GET /api/socket-token.
//
// With `review-v3` off the legacy `/analysis/<ref>` page still serves reviews (reviewHref(), H3 switches it to a
// redirect the other way), so this route sends the viewer there instead of rendering.
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { reviewGate } from "@/features/review/gate.server";
import { serverBuildId } from "@/lib/api/context";
import { getViewer } from "@/lib/auth/viewer";
import { logger } from "@/lib/logger";
import { RealtimeBoot } from "@/lib/realtime/RealtimeBoot";
import type { SocketToken } from "@/lib/realtime/connection";
import { createMetadata } from "@/lib/seo";
import { entFromSessionClaims, mintSocketTokenForViewer, SocketTokenConfigError } from "@/lib/socket-token";

export const metadata: Metadata = createMetadata({
  title: "Game Review",
  description: "Your game, graded move by move.",
  path: "/review",
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
    logger.error(`review layout: cannot mint a socket token (${err.message}); the client will fetch one`);
    return null;
  }
}

export default async function ReviewLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ ref: string }>;
}) {
  await reviewGate((await params).ref);
  const token = await mintToken();
  return (
    <>
      <RealtimeBoot token={token} buildId={serverBuildId()} />
      {children}
    </>
  );
}
