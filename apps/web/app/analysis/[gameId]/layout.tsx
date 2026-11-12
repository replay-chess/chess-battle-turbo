import { createMetadata } from "@/lib/seo";
import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { getFlags } from "@/lib/flags";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { legacyAnalysisTarget } from "@/lib/services/analysis/legacy-redirect";

export const metadata: Metadata = createMetadata({
  title: "Game Analysis",
  description: "Analyze chess game moves with AI-powered insights on ReplayChess.",
  path: "/analysis",
  noIndex: true,
});

/**
 * The legacy analysis page. With `analysis-redirect` on (H3, phase-03 plan §7.2 R1) it answers 308 to the game's
 * review (or its legend comparison; an unknown ref or a game the viewer did not play → /games) before the legacy
 * client page renders; off, it serves
 * the legacy page unchanged. H4 deletes the page and serves the same targets from a route handler.
 */
export default async function AnalysisLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ gameId: string }>;
}) {
  const [{ gameId }, viewer] = await Promise.all([params, getViewer()]);
  const flags = await getFlags(viewer);
  if (flags["analysis-redirect"]) {
    permanentRedirect(await legacyAnalysisTarget(rawDb(prisma), gameId, viewer ? { id: viewer.id, role: viewer.role } : null));
  }
  return children;
}
