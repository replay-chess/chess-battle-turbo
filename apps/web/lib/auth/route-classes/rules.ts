// Middleware decisions (plan phase-01 §7.6 steps 2, 4, 6, 7), kept pure so they are unit-tested without Next or Clerk.
// middleware.ts reads the request and env, calls these, and turns the answers into responses.
import { stripCheckoutParams } from "@/lib/billing/client";
import type { RcPublicMetadata } from "@/lib/auth/claims";
import { matcherFor } from "./index";

type Env = Readonly<Record<string, string | undefined>>;

const isOn = (v: string | undefined) => v?.trim().toLowerCase() === "on";

/** `MIDDLEWARE_MEMBER_GATE=on` (default off until the claims backfill ran) and the paywall itself not switched off. */
export function memberGateEnabled(env: Env): boolean {
  return isOn(env.MIDDLEWARE_MEMBER_GATE) && env.BILLING_PAYWALL?.toLowerCase() !== "off";
}

/** `EDGE_DOC_LIMIT=on`: the optional per-isolate document limiter (shipped off; the Vercel Firewall is the real layer). */
export function docLimitEnabled(env: Env): boolean {
  return isOn(env.EDGE_DOC_LIMIT);
}

/**
 * `X-Robots-Tag: noindex, nofollow` on every non-production response (CF SEC-3). `NEXT_PUBLIC_APP_ENV` decides when it is
 * set. When it is not, only a Vercel production deployment counts as production, so a production deploy that is
 * missing the variable is never de-indexed, while local `next dev` (no VERCEL_ENV) still gets the header.
 */
export function noindexFor(env: Env): boolean {
  const app = env.NEXT_PUBLIC_APP_ENV?.trim();
  if (app) return app !== "production";
  return env.VERCEL_ENV !== "production";
}

/** Same value as lib/auth/require-member-page.ts PATHNAME_HEADER (that module is server-only; the test checks they agree). */
export const PATHNAME_HEADER = "x-rc-pathname";

export const ROBOTS_HEADER = "X-Robots-Tag";
export const ROBOTS_VALUE = "noindex, nofollow";

// ---------------------------------------------------------------------------------------------------------------------
// Step 4: cross-site cookie mutations (CF SEC-9).

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/** Clerk's session cookie: `__session`, or `__session_<suffix>` on newer SDKs / multi-instance setups. */
export function hasClerkSessionCookie(cookieNames: Iterable<string>): boolean {
  for (const name of cookieNames) if (name === "__session" || name.startsWith("__session_")) return true;
  return false;
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export interface CrossSiteInput {
  method: string;
  /** Whether the request carries a Clerk session cookie. Bearer and cookieless calls are never blocked here. */
  hasSessionCookie: boolean;
  secFetchSite: string | null;
  origin: string | null;
  /** `req.nextUrl.origin`. */
  requestOrigin: string;
  /** `NEXT_PUBLIC_SITE_URL` (any URL; only its origin is used). */
  siteUrl?: string;
}

/**
 * True when a cookie-authenticated API mutation must be refused: `Sec-Fetch-Site` present and not `same-origin` (a
 * `same-site` subdomain is not trusted), or `Origin` present and neither this origin nor the configured site origin.
 */
export function crossSiteBlocked(i: CrossSiteInput): boolean {
  if (SAFE_METHODS.has(i.method.toUpperCase())) return false;
  if (!i.hasSessionCookie) return false;
  if (i.secFetchSite && i.secFetchSite.toLowerCase() !== "same-origin") return true;
  if (i.origin !== null) {
    const allowed = new Set([i.requestOrigin, originOf(i.siteUrl)].filter((o): o is string => !!o));
    if (!allowed.has(i.origin)) return true;
  }
  return false;
}

export const CROSS_SITE_MESSAGE = "Cross-site request blocked";

// ---------------------------------------------------------------------------------------------------------------------
// Step 6: member gate on the Clerk claim `md`.

/**
 * Where the gate sends a signed-in visitor of a member page, or null to let the page decide. Only an explicit
 * `entitled === false` redirects ("unknown is not no"); admins always pass. Lapsed → `reason=ended`, otherwise
 * `reason=required` (B26 default); `redirect_url` is the path + query with checkout-return params stripped.
 */
export function memberGateTarget(md: Partial<RcPublicMetadata> | null | undefined, pathWithQuery: string): string | null {
  if (!md || typeof md !== "object") return null;
  if (md.entitled !== false) return null;
  if (md.role === "ADMIN") return null;
  const reason = md.lapsed === true ? "ended" : "required";
  const back = stripCheckoutParams(pathWithQuery);
  return `/pricing?reason=${reason}&redirect_url=${encodeURIComponent(back)}`;
}

/** The path the page gate (`requireMemberPage`, header `x-rc-pathname`) returns to: path + query, checkout params stripped. */
export function returnPathOf(pathname: string, search: string): string {
  return stripCheckoutParams(`${pathname}${search}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Step 7: optional document limiter (EDGE_DOC_LIMIT=on).

export const DOC_LIMIT = 120;
export const DOC_WINDOW_MS = 60_000;
const DOC_MAX_KEYS = 10_000;

/** The catalogue pages the limiter watches. */
export const isDocLimitedPath = matcherFor(["/legends(.*)", "/openings(.*)"]);

/**
 * A full document load (not an RSC navigation or prefetch, not an API call): GET/HEAD with `Sec-Fetch-Dest: document`
 * or no `Sec-Fetch-Dest` at all (curl, bots). Next removes the flight headers (`RSC`, `Next-Router-Prefetch`) before
 * middleware sees the request, so browser soft navigations are excluded by their `Sec-Fetch-Dest: empty`; the header
 * checks only matter if a future Next passes them through.
 */
export function isDocumentRequest(method: string, headers: Pick<Headers, "get">): boolean {
  if (!SAFE_METHODS.has(method.toUpperCase())) return false;
  if (headers.get("rsc") || headers.get("next-router-prefetch")) return false;
  const dest = headers.get("sec-fetch-dest");
  return dest === null || dest === "document";
}

/** The caller's IP for the limiter key: `x-real-ip`, else the first `x-forwarded-for` hop, else "unknown". */
export function clientIpOf(headers: Pick<Headers, "get">): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || "unknown";
}

export type DocLimitResult = { limited: false } | { limited: true; retryAfterSec: number };

export interface DocLimiter {
  hit(key: string, nowMs: number): DocLimitResult;
  readonly size: number;
}

/**
 * Fixed window per key, in this isolate's memory only (isolates don't share it; best effort, IS §3.6). The map is
 * bounded: when it is full, expired windows are dropped, and if it is still full the oldest key goes.
 */
export function createDocLimiter(opts: { limit?: number; windowMs?: number; maxKeys?: number } = {}): DocLimiter {
  const limit = opts.limit ?? DOC_LIMIT;
  const windowMs = opts.windowMs ?? DOC_WINDOW_MS;
  const maxKeys = opts.maxKeys ?? DOC_MAX_KEYS;
  const windows = new Map<string, { start: number; count: number }>();

  const makeRoom = (now: number) => {
    for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
    while (windows.size >= maxKeys) {
      const oldest = windows.keys().next().value;
      if (oldest === undefined) break;
      windows.delete(oldest);
    }
  };

  return {
    hit(key, now) {
      let w = windows.get(key);
      if (!w || now - w.start >= windowMs) {
        if (w) windows.delete(key);
        else if (windows.size >= maxKeys) makeRoom(now);
        w = { start: now, count: 0 };
        windows.set(key, w);
      }
      w.count += 1;
      if (w.count <= limit) return { limited: false };
      return { limited: true, retryAfterSec: Math.max(1, Math.ceil((w.start + windowMs - now) / 1000)) };
    },
    get size() {
      return windows.size;
    },
  };
}

/** The rewrite target for a limited document: `/too-many-requests?retry=<sec>&from=<path+query>`. */
export function tooManyRequestsPath(retryAfterSec: number, from: string): string {
  return `/too-many-requests?retry=${retryAfterSec}&from=${encodeURIComponent(from)}`;
}
