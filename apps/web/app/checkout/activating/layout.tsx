// /checkout/activating layout (phase-04 plan 4.9, 5.4, 5.6; board DR/V3CheckoutActivating). The marketing top bar
// (`.tn`, 64 px; 48 px at ≤ 640 px tall) as static markup until P11's MarketingTopNav, the one-viewport frame, and
// RealtimeBoot with a socket token minted in this render (client-data-layer 5.1): no socket opens until the page's
// "activation" hold acquires it. `/checkout(.*)` is a signed-in route class (p01), so middleware sends a signed-out
// visitor to sign-in first; a viewer that still cannot be read here (inactive) goes to sign-in too.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { serverBuildId } from "@/lib/api/context";
import { getViewer, type Viewer } from "@/lib/auth/viewer";
import { logger } from "@/lib/logger";
import { RealtimeBoot } from "@/lib/realtime/RealtimeBoot";
import type { SocketToken } from "@/lib/realtime/connection";
import { createMetadata } from "@/lib/seo";
import { entFromSessionClaims, mintSocketTokenForViewer, SocketTokenConfigError } from "@/lib/socket-token";
import { ActivatingTopNav } from "./TopNav";

export const metadata: Metadata = createMetadata({
  title: "Activating your membership",
  description: "Confirming your Replay Chess checkout.",
  path: "/checkout/activating",
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
    logger.error(`checkout activating layout: cannot mint a socket token (${err.message}); the client will fetch one`);
    return null;
  }
}

export default async function CheckoutActivatingLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect(`/sign-in?redirect_url=${encodeURIComponent("/checkout/activating")}`);
  const token = await mintToken(viewer);
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-cb-bg text-cb-text" data-testid="checkout-activating-frame">
      <ActivatingTopNav name={viewer.user.name} profileHref={`/profile/${viewer.ref}`} />
      <RealtimeBoot token={token} buildId={serverBuildId()} />
      {children}
    </div>
  );
}
