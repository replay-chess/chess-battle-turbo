// The weakness payload of one request (phase-06 plan §5.2): the [pattern] layout validates the slug against it and the
// page seeds the query cache with it; React's cache() makes that one read (getWeakness: the DAL, not HTTP).
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { patternFromSlug } from "@repo/chess-training/weakness/slug";
import type { Viewer } from "@/lib/auth/viewer";
import { getWeakness, payloadHasPattern, weaknessEnabled } from "@/lib/train/weakness.server";
import { trainGate } from "../gate";

export const loadWeakness = cache((viewer: Viewer) => getWeakness(viewer));

/**
 * The /train/weakness gate: the train gate, then the `weakness` flag (off → /train, plan §7.8). The layout runs it, and
 * so does every page (FIX-1): a soft navigation, or a crafted RSC request whose router state says the layout is mounted,
 * renders only the page segment, so a page that checked only trainGate() served the payload with the flag off.
 */
export async function weaknessGate(): Promise<Viewer> {
  const viewer = await trainGate();
  if (!(await weaknessEnabled(viewer))) redirect("/train");
  return viewer;
}

/** The [pattern] gate: weaknessGate, then the slug must name one of a READY profile's rows (else the profile). */
export async function weaknessPatternGate(slug: string): Promise<Viewer> {
  const key = patternFromSlug(slug);
  if (!key) redirect("/train/weakness");
  const viewer = await weaknessGate();
  const payload = await loadWeakness(viewer);
  if (payload.status !== "ready" || !payloadHasPattern(payload, key)) redirect("/train/weakness");
  return viewer;
}

const ENTRIES = new Set(["nav", "hub", "home", "palette", "chord", "direct", "dot"]);

/** `?from=` → the `weakness_viewed.entry` property (unknown or absent: a direct visit). */
export function entryOf(from: string | string[] | undefined): "nav" | "hub" | "home" | "palette" | "chord" | "direct" | "dot" {
  const v = Array.isArray(from) ? from[0] : from;
  return v && ENTRIES.has(v) ? (v as "nav") : "direct";
}
