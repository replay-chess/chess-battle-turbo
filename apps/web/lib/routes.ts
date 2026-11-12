// App paths that depend on a flag or on the deployment (phase-03 plan §3.3, §7.9, §7.10). Client-safe: reads only
// NEXT_PUBLIC_* variables, and the path builders come from the zod-free contract module (@repo/contracts/http/plain),
// so the server, the client and the tests build the same URLs without zod in a client chunk.
import { legendComparePath, reviewPath } from "@repo/contracts/http/plain";

const LOCAL_ORIGIN = "http://localhost:3000";

/**
 * The absolute origin for links that leave the app (share URLs, the PGN `Site` header): NEXT_PUBLIC_SITE_URL (the dev
 * URL on dev, https://playchess.tech in production), else Vercel's production host, else the local dev server.
 */
export function siteOrigin(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return LOCAL_ORIGIN;
}

/**
 * Where "review this game" goes: the P3 review with the flag `review-v3` on, else the legacy `/analysis` page (which
 * the H3 cut-over turns into a redirect to `/review`).
 */
export function reviewHref(ref: string, reviewV3: boolean, options: Parameters<typeof reviewPath>[1] = {}): string {
  return reviewV3 ? reviewPath(ref, options) : `/analysis/${encodeURIComponent(ref)}`;
}

/** The compare page of a legend game (legacy: the same `/analysis` page, which showed the legend inline). */
export function legendHref(ref: string, reviewV3: boolean): string {
  return reviewV3 ? legendComparePath(ref) : `/analysis/${encodeURIComponent(ref)}`;
}
