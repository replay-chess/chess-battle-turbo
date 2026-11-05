// The six cache tiers (plan §7.2.1, P1-19; CA AP-03, AP-04). route() sets these headers; handlers never do.
//
// | tier             | headers                                                                                   |
// | public-immutable | Cache-Control: public, max-age=31536000, immutable · strong ETag                          |
// | public-static    | Cache-Control: public, max-age=0, must-revalidate · Vercel-CDN-Cache-Control: public,      |
// |                  | s-maxage=<s>, stale-while-revalidate=<swr> · Vercel-Cache-Tag · strong ETag                |
// | public-short     | Cache-Control: public, max-age=0 · Vercel-CDN-Cache-Control: s-maxage=15, swr=60 · tag     |
// | private-etag     | Cache-Control: private, no-cache · ETag; If-None-Match equal → 304                         |
// | no-store         | Cache-Control: private, no-store (also every error)                                        |
// | sse              | Cache-Control: no-cache, no-transform · text/event-stream · X-Accel-Buffering: no          |
import type { CacheTier, EndpointDef } from "@repo/contracts/http/endpoint";
import { cacheTierOf } from "@repo/contracts/http/endpoint";

export const NO_STORE = "private, no-store";
export const PUBLIC_SHORT = { sMaxAge: 15, swr: 60 } as const;
export const IMMUTABLE_MAX_AGE = 31_536_000;

/** Tiers whose responses carry a strong ETag and answer If-None-Match with 304. */
export const ETAG_TIERS: ReadonlySet<CacheTier> = new Set(["public-immutable", "public-static", "private-etag"]);

export class CacheHeaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheHeaderError";
  }
}

export function isPublicTier(tier: CacheTier): boolean {
  return tier.startsWith("public-");
}

type TierSpec = Pick<EndpointDef, "cache" | "publicStatic" | "publicShort">;

/** Vercel-Cache-Tag value: comma-separated, deduplicated, safe characters only. */
export function cacheTagHeader(tags: readonly string[]): string {
  for (const tag of tags) {
    if (!/^[A-Za-z0-9:_.-]{1,128}$/.test(tag)) throw new CacheHeaderError(`invalid cache tag "${tag}"`);
  }
  return Array.from(new Set(tags)).join(",");
}

/** Headers for a successful response of this tier (ETag is added by the caller when the tier uses one). */
export function tierHeaders(spec: TierSpec): Record<string, string> {
  const tier = cacheTierOf(spec as EndpointDef);
  switch (tier) {
    case "public-immutable":
      return { "Cache-Control": `public, max-age=${IMMUTABLE_MAX_AGE}, immutable` };
    case "public-static": {
      const ps = spec.publicStatic;
      if (!ps) throw new CacheHeaderError(`public-static requires publicStatic`);
      return {
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Vercel-CDN-Cache-Control": `public, s-maxage=${ps.sMaxAge}, stale-while-revalidate=${ps.swr}`,
        "Vercel-Cache-Tag": cacheTagHeader(ps.tags),
      };
    }
    case "public-short": {
      const headers: Record<string, string> = {
        "Cache-Control": "public, max-age=0",
        "Vercel-CDN-Cache-Control": `public, s-maxage=${PUBLIC_SHORT.sMaxAge}, stale-while-revalidate=${PUBLIC_SHORT.swr}`,
      };
      if (spec.publicShort?.tags.length) headers["Vercel-Cache-Tag"] = cacheTagHeader(spec.publicShort.tags);
      return headers;
    }
    case "private-etag":
      return { "Cache-Control": "private, no-cache" };
    case "sse":
      return {
        "Cache-Control": "no-cache, no-transform",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
      };
    case "no-store":
      return { "Cache-Control": NO_STORE };
  }
}

/** max-age / s-maxage values in a Cache-Control (or CDN-Cache-Control) header. */
export function lifetimesIn(cacheControl: string | null | undefined): { maxAge: number | null; sMaxAge: number | null } {
  const read = (name: string) => {
    const match = new RegExp(`(?:^|[,\\s])${name}\\s*=\\s*"?(\\d+)"?`, "i").exec(cacheControl ?? "");
    return match ? Number(match[1]) : null;
  };
  return { maxAge: read("max-age"), sMaxAge: read("s-maxage") };
}

/**
 * The invariant no handler may break: a non-public response never carries a lifetime (max-age > 0 or any s-maxage,
 * on Cache-Control or a CDN header). Returns the problem, or null.
 */
export function lifetimeViolation(tier: CacheTier, headers: Headers): string | null {
  if (isPublicTier(tier)) return null;
  for (const name of ["cache-control", "cdn-cache-control", "vercel-cdn-cache-control"]) {
    const value = headers.get(name);
    if (!value) continue;
    const { maxAge, sMaxAge } = lifetimesIn(value);
    if ((maxAge ?? 0) > 0) return `${name} has max-age=${maxAge} on a "${tier}" response`;
    if (sMaxAge !== null) return `${name} has s-maxage on a "${tier}" response`;
    if (/(^|[,\s])public([,\s]|$)/i.test(value)) return `${name} is public on a "${tier}" response`;
  }
  return null;
}
