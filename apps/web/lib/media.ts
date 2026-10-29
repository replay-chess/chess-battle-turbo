/**
 * Large media (sounds, videos) lives in the Cloudflare R2 bucket
 * `replay-chess-media`, uploaded with `pnpm --filter web media:upload`.
 * NEXT_PUBLIC_MEDIA_URL is the bucket's public base URL; when it is unset the
 * same paths are served from public/ as before.
 */
const MEDIA_URL = (process.env.NEXT_PUBLIC_MEDIA_URL ?? "").replace(/\/+$/, "");

/** Absolute URL for a media path such as "/sounds/move.webm". */
export function mediaUrl(path: string): string {
  return `${MEDIA_URL}${path}`;
}

