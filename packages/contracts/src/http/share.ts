// Review shares (phase-03 plan §4.3, §4.4, §5.4, §5.5, §7.2 A10–A12, §11.3; P3-D4). Registry entries live in
// registry/review.ts. A share is a frozen snapshot (`shares.snapshot`, DB/src/json/share.ts ShareSnapshotV1): the
// public page `/r/<code>` and its image read nothing else.
import { z } from "zod";
import { IsoDateTime } from "./common";

/** 8 Crockford base32 chars, lowercase, from 5 random bytes (40 bits). No i, l, o, u. */
export const SHARE_CODE_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export const SHARE_CODE_LENGTH = 8;
export const ShareCode = z.string().regex(/^[0-9a-hjkmnp-tv-z]{8}$/);
export type ShareCode = z.infer<typeof ShareCode>;

/** Links expire this long after creation; the public page shows `gone` within 1 h of expiry (ISR). */
export const SHARE_TTL_DAYS = 30;
/** HOUSEKEEPING deletes REVIEW shares this long after they expired. */
export const SHARE_PURGE_AFTER_DAYS = 7;
/** A10's daily cap per user, counted from `shares` (the burst limit is 5 / 60 s). */
export const SHARE_DAILY_CAP = 20;
/** `/r/<code>` ISR revalidate, and the negative-cache window of an unknown code. */
export const SHARE_REVALIDATE_SEC = 3_600;
/** Browser and social-cache TTL of a live share image (a CDN purge cannot reach them). */
export const SHARE_IMAGE_MAX_AGE_SEC = 3_600;
/** TTL of the generic card answered for a gone or unknown share. */
export const SHARE_IMAGE_GONE_MAX_AGE_SEC = 300;
export const SHARE_IMAGE_WIDTH = 1_200;
export const SHARE_IMAGE_HEIGHT = 630;

export const ShareCodeParams = z.object({ code: ShareCode });
export type ShareCodeParams = z.infer<typeof ShareCodeParams>;

/** Where the share screen was opened from (the `share_*` analytics events carry it, §10.1). */
export const SHARE_FROM = ["review_menu", "complete"] as const;
export const ShareFrom = z.enum(SHARE_FROM);
export type ShareFrom = z.infer<typeof ShareFrom>;

// ── A10 `POST /api/review/[ref]/share` (+ Idempotency-Key) → 201, or 200 reusing an identical live share ───────
export const ShareCreateBody = z.object({
  showUsername: z.boolean().default(true),
  /** The moment shown on the card; default the worst moment (or the best decision of a clean game). */
  momentPly: z.number().int().min(0).optional(),
  /** For the server event `share_link_created` only; it never changes the link (reuse ignores it). */
  from: ShareFrom.default("review_menu"),
});
export type ShareCreateBody = z.infer<typeof ShareCreateBody>;
export type ShareCreateInput = z.input<typeof ShareCreateBody>;

export const ShareDTO = z.object({
  code: ShareCode,
  /** Absolute: `${NEXT_PUBLIC_SITE_URL}/r/<code>`. */
  url: z.url(),
  /** Absolute image URL with the cache-busting `?v=<imageVersion>`. */
  imageUrl: z.url(),
  expiresAt: IsoDateTime,
  showUsername: z.boolean(),
});
export type ShareDTO = z.infer<typeof ShareDTO>;

// ── A11 `PATCH /api/share/[code]` → ShareDTO (imageVersion + 1); `DELETE /api/share/[code]` → 204 ──────────────
export const ShareUpdateBody = z.object({ showUsername: z.boolean() }).strict();
export type ShareUpdateBody = z.infer<typeof ShareUpdateBody>;

// ── Paths and cache tags (one spelling for the routes, the page, the image route and the purge) ────────────────
/** The ISR / data-cache tag and the `Vercel-Cache-Tag` of a share. */
export function shareCacheTag(code: string): string {
  return `share:${code}`;
}

export function sharePagePath(code: string): string {
  return `/r/${code}`;
}

export function shareImagePath(code: string, imageVersion: number, options: { download?: boolean } = {}): string {
  return `/r/${code}/og?v=${imageVersion}${options.download ? "&download=1" : ""}`;
}

/** `replaychess-review-<code>.png` (`?download=1`). */
export function shareImageFilename(code: string): string {
  return `replaychess-review-${code}.png`;
}

/** Encodes 5 random bytes as a share code (the caller supplies the bytes: crypto in Node, nothing in the browser). */
export function encodeShareCode(bytes: Uint8Array): string {
  if (bytes.length !== 5) throw new Error("encodeShareCode: needs exactly 5 bytes");
  // 40 bits fit a double exactly (< 2^53), so plain arithmetic is safe and needs no BigInt (web targets ES2017).
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  let out = "";
  for (let i = 0; i < SHARE_CODE_LENGTH; i++) {
    out = SHARE_CODE_ALPHABET.charAt(value % 32) + out;
    value = Math.floor(value / 32);
  }
  return out;
}
