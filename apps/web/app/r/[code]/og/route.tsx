// The share image `/r/<code>/og?v=<imageVersion>[&download=1]` (phase-03 plan §5.5, §9.4, §11.3; AP-05).
//
// - Reads the same tagged loader as the page (`loadPublicShare`: the frozen snapshot only, `share:<code>` tag).
// - A live share → the 1200×630 share card. Browsers and social caches keep it 1 h (`max-age=3600`: a CDN purge
//   cannot reach them, and every edit bumps `?v=`); the Vercel CDN keeps it a year under the tag `share:<code>`, which
//   A11's purge deletes on Stop Sharing and on the username toggle (`dangerouslyDeleteByTag`, WP-D). Both TTLs end at
//   the share's expiry at the latest (nothing purges an expired link); a link whose time is up is served as gone.
// - The card's piece and badge images are fetched by satori from the configured site origin (`siteOrigin()`), never
//   from the request's Host header (a forged Host would point those server-side fetches elsewhere, FIX-1).
// - Revoked, expired, unknown or malformed → the generic Replay Chess card, 5 minutes everywhere: never the old board
//   or names.
// - `?download=1` adds `Content-Disposition: attachment` and is otherwise the same response.
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { addCacheTag } from "@vercel/functions";
import { SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH, shareCacheTag } from "@repo/contracts/http/share";
import { loadPublicShare } from "@/lib/data/share";
import { genericCard, shareCard } from "@/lib/og/cards";
import { SHARE_FALLBACK_CARD } from "@/lib/og/theme";
import { siteOrigin } from "@/lib/routes";
import { shareCardInput, shareImageHeaders, shareImageTtlSec } from "../card-input";
import { shareViewOf } from "../share-view";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const download = request.nextUrl.searchParams.get("download") === "1";
  const share = await loadPublicShare(code);
  const size = { width: SHARE_IMAGE_WIDTH, height: SHARE_IMAGE_HEIGHT };

  const nowMs = Date.now();
  if (share.state !== "ok" || shareImageTtlSec(share.expiresAt, nowMs) === 0) {
    return new ImageResponse(genericCard(SHARE_FALLBACK_CARD), { ...size, headers: shareImageHeaders("gone", code, download) });
  }

  // The CDN tag through the Vercel runtime too (the header above carries it as well; a no-op off Vercel).
  await addCacheTag(shareCacheTag(code)).catch(() => undefined);
  const input = shareCardInput(shareViewOf(share.snapshot));
  return new ImageResponse(shareCard(input, siteOrigin()), {
    ...size,
    headers: shareImageHeaders("ok", code, download, { expiresAt: share.expiresAt, nowMs }),
  });
}
