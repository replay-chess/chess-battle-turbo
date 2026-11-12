// The /practice gate (phase-03 plan §11.1 "/practice, PR1": signed out → sign-in; never a member or lapsed → pricing
// (practice is a member feature, no lapsed read); `review-v3` off → 404, the screen does not exist yet). Shared by the
// layout (the redirects run there, before loading.tsx streams: P2 FIX-A) and the page (soft navigations skip layouts);
// getViewer() and getFlags() are cache()'d, so the second call costs nothing. The return path is the full URL with its
// query (`x-rc-pathname` from middleware), so sign-in comes back to the same position.
import "server-only";
import { notFound } from "next/navigation";
import { requireMemberPage } from "@/lib/auth/require-member-page";
import type { Viewer } from "@/lib/auth/viewer";
import { getFlags } from "@/lib/flags";

export async function practiceGate(): Promise<Viewer> {
  const viewer = await requireMemberPage();
  const flags = await getFlags(viewer);
  if (!flags["review-v3"]) notFound();
  return viewer;
}
