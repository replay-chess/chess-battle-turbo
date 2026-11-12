// The `review-share` gate of A10 (phase-03 plan §7.10, §7.2 A10: 404 while the flag is off). Only creation is
// flagged: A11 stays open to owners of existing links so they can always turn one off, and `/r/*` is not flagged
// (the public page never evaluates a per-user flag, §5.5). Evaluated per request through lib/flags (PostHog,
// FLAGS_OVERRIDE in e2e); tests replace it with setShareFlag().
import type { Viewer } from "@/lib/auth/viewer";

export type ShareFlag = (viewer: Viewer) => Promise<boolean>;

const defaultShareFlag: ShareFlag = async (viewer) => {
  const { getFlags } = await import("@/lib/flags");
  return (await getFlags(viewer))["review-share"];
};

let shareFlag: ShareFlag = defaultShareFlag;

/** Test seam for the flag; returns a restore function. */
export function setShareFlag(next: ShareFlag): () => void {
  const previous = shareFlag;
  shareFlag = next;
  return () => {
    shareFlag = previous;
  };
}

export function shareEnabledFor(viewer: Viewer): Promise<boolean> {
  return shareFlag(viewer);
}
