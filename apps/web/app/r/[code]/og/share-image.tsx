// The share image's response (`/r/<code>/og`, route.tsx), testable without Next's data cache or the Vercel runtime:
// the route passes its tagged loader in. A route file may export only its handlers, hence this module.
import { ImageResponse } from "next/og";
import { addCacheTag } from "@vercel/functions";
import { SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH, shareCacheTag } from "@repo/contracts/http/share";
import { genericCard, shareCard } from "@/lib/og/cards";
import { SHARE_FALLBACK_CARD } from "@/lib/og/theme";
import { siteOrigin } from "@/lib/routes";
import type { PublicShare } from "@/lib/services/analysis/share";
import { shareCardInput, shareImageHeaders, shareImageTtlSec } from "../card-input";
import { shareViewOf } from "../share-view";

export type ShareImageDeps = {
  load(code: string): Promise<PublicShare>;
  /** `addCacheTag` of @vercel/functions (the default). */
  addTag?: (tag: string) => unknown;
  now?: () => number;
};

/**
 * Tags the response for the Vercel CDN, best-effort. The runtime's `addCacheTag` is not guaranteed to return a Promise:
 * on Vercel it returned `undefined`, and `addCacheTag(tag).catch(…)` threw "Cannot read properties of undefined
 * (reading 'catch')", a 500 for every live share (regression: og-addcachetag-void). A sync throw, a rejection and a
 * plain value all end here; the `Vercel-Cache-Tag` header carries the tag anyway.
 */
export async function tagForCdn(tag: string, add: (tag: string) => unknown = addCacheTag): Promise<void> {
  try {
    await add(tag);
  } catch {
    // The header still tags the response.
  }
}

export async function shareImageResponse(code: string, download: boolean, deps: ShareImageDeps): Promise<Response> {
  const share = await deps.load(code);
  const size = { width: SHARE_IMAGE_WIDTH, height: SHARE_IMAGE_HEIGHT };

  const nowMs = (deps.now ?? Date.now)();
  if (share.state !== "ok" || shareImageTtlSec(share.expiresAt, nowMs) === 0) {
    return new ImageResponse(genericCard(SHARE_FALLBACK_CARD), { ...size, headers: shareImageHeaders("gone", code, download) });
  }

  // The CDN tag through the Vercel runtime too (the header carries it as well; a no-op off Vercel).
  await tagForCdn(shareCacheTag(code), deps.addTag);
  const input = shareCardInput(shareViewOf(share.snapshot));
  return new ImageResponse(shareCard(input, siteOrigin()), {
    ...size,
    headers: shareImageHeaders("ok", code, download, { expiresAt: share.expiresAt, nowMs }),
  });
}
