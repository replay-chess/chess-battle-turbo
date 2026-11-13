// /onboarding/* layout (phase-04 plan §4.0, §5.4 "Layout", §5.6). Server.
//
// - Seeds the viewer query `qk.me()` (HydrationBoundary), so the steps' client code (useOnboardingStep, useFlag)
//   makes no GET /api/me on a hard load. The QueryClientProvider is the root layout's (app/providers.tsx).
// - No realtime here: the two steps that hold the socket (activating, done) mint the token in their own render and
//   boot the connection before their live content (lib/onboarding/socket-token.ts), so the other steps never load
//   socket.io-client and a long-lived layout never hands out a stale token.
// - Keeps `noIndex`. Signed-out requests never get here (middleware: /onboarding(.*) is signed_in).
// The frame (OnboardingShell) is the (flow) group's layout, so the resolver and the legacy page render without it.
import type { Metadata } from "next";
import { HydrationBoundary } from "@tanstack/react-query";
import { serverBuildId } from "@/lib/api/context";
import { qk } from "@/lib/api/keys";
import { getViewer } from "@/lib/auth/viewer";
import { meDataOf } from "@/lib/auth/viewer-dto";
import { ledgerAwareViewer } from "@/lib/billing/ledger-viewer";
import { getFlags } from "@/lib/flags";
import { dehydrateFor, getServerQueryClient } from "@/lib/query/server";
import { createMetadata } from "@/lib/seo";

export const metadata: Metadata = createMetadata({
  title: "Set up your coach",
  description: "Link your games, tell us your level and goals, and start your free trial.",
  path: "/onboarding",
  noIndex: true,
});

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  const qc = getServerQueryClient();
  if (viewer) {
    const flags = await getFlags(viewer);
    // trial.eligible asks the trial ledger too (FIX-2; one probe per request, shared with Welcome and Plan).
    qc.setQueryData(qk.me(), meDataOf(await ledgerAwareViewer(viewer), flags, serverBuildId()));
  }
  return <HydrationBoundary state={dehydrateFor(qc)}>{children}</HydrationBoundary>;
}
