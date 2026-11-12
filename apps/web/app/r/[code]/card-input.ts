// The share image's inputs (phase-03 plan §5.5): the card shows the frame the page opens on (the key moment, else
// the final position) with its last move, the engine's arrow on a key moment and the grade badge of the moved piece,
// plus the sharer-first title, the meta line, the sharer's accuracy and the moment's caption. Pure, unit-tested; the
// response headers of the image route live here too (a route file may export only its handlers).
import {
  SHARE_IMAGE_GONE_MAX_AGE_SEC,
  SHARE_IMAGE_MAX_AGE_SEC,
  ShareCode,
  shareCacheTag,
  shareImageFilename,
} from "@repo/contracts/http/share";
import { badgeIcon } from "@/components/board/BadgeLayer";
import { parsePlacement } from "@/components/board/geometry";
import type { ShareCardInput } from "@/lib/og/cards";
import type { ShareView } from "./share-view";

const EMPTY = parsePlacement("8/8/8/8/8/8/8/8 w - - 0 1");

/** One CDN year: the tag purge (A11), not the TTL, ends a live card. */
export const SHARE_IMAGE_CDN_SEC = 31_536_000;

export function shareCardInput(view: ShareView): ShareCardInput {
  const frame = view.frames[view.startIndex] ?? view.frames[view.frames.length - 1] ?? null;
  const icon = frame?.q ? badgeIcon(frame.q, "a1", EMPTY) : null;
  return {
    title: view.title,
    meta: view.meta,
    accuracy: view.accuracy.you,
    caption: view.moment?.caption ?? view.summary[0] ?? null,
    label: "Game review",
    board: {
      fen: frame?.placement ?? "8/8/8/8/8/8/8/8",
      orientation: view.orientation,
      last: frame?.last ?? null,
      arrow: view.moment && view.moment.index === view.startIndex ? view.moment.arrow : null,
      badge: frame?.last && icon ? { sq: frame.last[1], icon } : null,
    },
  };
}

/** The download name when the path's code is not a share code (never echo an unvalidated path segment). */
export const SHARE_IMAGE_FALLBACK_FILENAME = "replaychess-review.png";

/** Seconds a live card may be cached: until the share expires (null = no expiry), never below 0. */
export function shareImageTtlSec(expiresAt: string | null, nowMs: number): number | null {
  if (expiresAt === null) return null;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) ? Math.max(0, Math.floor((at - nowMs) / 1000)) : 0;
}

/**
 * The image's headers. Live = 1 h in browsers and a CDN year under the share's tag, both capped at the share's expiry:
 * the tag purge ends a card on Stop Sharing, but nothing purges at expiry, so the TTL itself must end with the link
 * (§11.3, FIX-1). A live share with no time left is served as gone. Gone = 5 min everywhere, no tag. The download name
 * uses the code only when it is a valid share code (the path segment is never echoed unvalidated, FIX-1).
 */
export function shareImageHeaders(
  state: "ok" | "gone",
  code: string,
  download: boolean,
  live: { expiresAt: string | null; nowMs: number } = { expiresAt: null, nowMs: Date.now() },
): Record<string, string> {
  const ttl = state === "ok" ? shareImageTtlSec(live.expiresAt, live.nowMs) : 0;
  const ok = state === "ok" && ttl !== 0;
  const headers: Record<string, string> = ok
    ? {
        "Cache-Control": `public, max-age=${Math.min(SHARE_IMAGE_MAX_AGE_SEC, ttl ?? SHARE_IMAGE_MAX_AGE_SEC)}`,
        "Vercel-CDN-Cache-Control": `public, s-maxage=${Math.min(SHARE_IMAGE_CDN_SEC, ttl ?? SHARE_IMAGE_CDN_SEC)}`,
        "Vercel-Cache-Tag": shareCacheTag(code),
      }
    : {
        "Cache-Control": `public, max-age=${SHARE_IMAGE_GONE_MAX_AGE_SEC}`,
        "Vercel-CDN-Cache-Control": `public, s-maxage=${SHARE_IMAGE_GONE_MAX_AGE_SEC}`,
      };
  if (download) {
    const name = ShareCode.safeParse(code).success ? shareImageFilename(code) : SHARE_IMAGE_FALLBACK_FILENAME;
    headers["Content-Disposition"] = `attachment; filename="${name}"`;
  }
  return headers;
}
