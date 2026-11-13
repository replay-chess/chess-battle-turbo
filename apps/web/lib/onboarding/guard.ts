// The onboarding rule of middleware (phase-04 plan §8.1 "Middleware rule", D4-16, D4-29, §11.1). Pure apart from
// Web Crypto (cookie signatures), so it runs in the Edge middleware and in unit tests alike. middleware.ts calls
// `onboardingGate()` in one block after the session check and turns the decision into a response.
//
// Rules, for a signed-in request to a non-public page (middleware never calls this for public pages or /api):
//   1. /onboarding(.*):
//      - an onboarded, lapsed non-admin (claims) → /pricing?reason=ended (access matrix §11.1), unless the paywall
//        is off;
//      - a safe `?redirect_url=` (P11's sign-in hand-over) → set `rc_onb_next` on the pass-through response.
//   2. Pages a not-yet-onboarded user must reach (/checkout/activating, /settings/connected, /settings/account,
//      /settings/membership) → pass.
//   3. Claims say "not onboarded" (`md.onboarded !== true`, with `md` present: unknown is not no, P1's gate rule)
//      and no valid `rc_onb` → /onboarding?redirect_url=<path+query> with `rc_onb_next` set on that redirect.
//   4. A valid `rc_act` (activation just confirmed, the JWT does not say so yet) → `skipMemberGate`.
import type { RcPublicMetadata } from "@/lib/auth/claims";
import { matcherFor } from "@/lib/auth/route-classes";
import { ACT_COOKIE, ONB_COOKIE, claimCookieSecret, verifyClaimCookie } from "./claim-cookie";
import { ONBOARDING_EXEMPT_PREFIXES } from "./exempt-paths";
import { ONBOARDING_ROOT } from "./steps";

/** Cookie holding where Done forwards to (Path /onboarding, 24 h, HttpOnly). Read only through `readNextCookie`. */
export const NEXT_COOKIE = "rc_onb_next";
export const NEXT_COOKIE_MAX_AGE_SEC = 24 * 60 * 60;
/** Longest destination kept. */
export const NEXT_PATH_MAX = 512;

/** Pages outside /onboarding that a member-to-be must reach before finishing (checkout return, settings). */
export const ONBOARDING_EXEMPT_PATHS: readonly string[] = ONBOARDING_EXEMPT_PREFIXES.map((p) =>
  p === ONBOARDING_ROOT ? `${ONBOARDING_ROOT}(.*)` : p,
);

const isExempt = matcherFor(ONBOARDING_EXEMPT_PATHS);
const isOnboarding = matcherFor(["/onboarding(.*)"]);

// Destinations that make no sense after onboarding (loops, auth pages, APIs).
const NOT_A_DESTINATION = matcherFor(["/onboarding(.*)", "/sign-in(.*)", "/sign-up(.*)", "/api(.*)", "/checkout(.*)"]);

/** Any C0 control character or DEL. */
function hasControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * A same-site path to continue to after onboarding, or null. Rejects absolute and protocol-relative URLs, `/\`,
 * backslashes and control characters anywhere, encoded variants of those (`/%2F`, `/%5C`), anything that resolves to
 * another origin, onboarding/auth/API paths, and paths over 512 characters.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > NEXT_PATH_MAX) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || hasControl(value)) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (decoded.startsWith("//") || decoded.includes("\\") || hasControl(decoded)) return null;
  let url: URL;
  try {
    url = new URL(value, "https://rc.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://rc.invalid") return null;
  // The normalised path is checked again (FIX-1): dot segments collapse `/.//evil.com`, `/games/..//evil.com` and
  // `/%2e//evil.com` to `//evil.com`, which a redirect would resolve to another origin. Any empty segment is refused.
  if (url.pathname.includes("//") || /%2f|%5c/i.test(url.pathname)) return null;
  if (NOT_A_DESTINATION(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The Set-Cookie header for `rc_onb_next`. The value is URI-encoded; it is re-validated whenever it is read. */
export function nextCookieHeader(path: string, opts: { secure: boolean }): string {
  const parts = [
    `${NEXT_COOKIE}=${encodeURIComponent(path)}`,
    `Path=${ONBOARDING_ROOT}`,
    `Max-Age=${NEXT_COOKIE_MAX_AGE_SEC}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/** The destination stored in `rc_onb_next`, or null when absent or no longer safe. */
export function readNextCookie(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return safeNextPath(decodeURIComponent(value));
  } catch {
    return null;
  }
}

export type GateInput = {
  /** `sessionClaims.md` (RcPublicMetadata when the claims were synced; anything else is "unknown"). */
  md: unknown;
  clerkUserId: string;
  pathname: string;
  /** `req.nextUrl.search` ("" or "?…"). */
  search: string;
  cookie: (name: string) => string | undefined;
  nowMs: number;
  env: Readonly<Record<string, string | undefined>>;
  /** Set cookies with `Secure`. */
  secure: boolean;
};

export type GateDecision = {
  /** Redirect target (302), or null to continue. */
  redirect: string | null;
  /** Set-Cookie header values for the response (redirect or pass-through). */
  setCookies: string[];
  /** A valid `rc_act`: the member gate must not send this request to /pricing. */
  skipMemberGate: boolean;
};

const PASS: GateDecision = Object.freeze({ redirect: null, setCookies: [], skipMemberGate: false }) as GateDecision;

function claimsOf(md: unknown): Partial<RcPublicMetadata> | null {
  return md && typeof md === "object" && !Array.isArray(md) ? (md as Partial<RcPublicMetadata>) : null;
}

function paywallOff(env: GateInput["env"]): boolean {
  return env.BILLING_PAYWALL?.trim().toLowerCase() === "off";
}

export async function onboardingGate(i: GateInput): Promise<GateDecision> {
  const md = claimsOf(i.md);
  const secret = claimCookieSecret(i.env);

  if (isOnboarding(i.pathname)) {
    if (md && md.onboarded === true && md.lapsed === true && md.entitled === false && md.role !== "ADMIN" && !paywallOff(i.env)) {
      return { redirect: "/pricing?reason=ended", setCookies: [], skipMemberGate: false };
    }
    const next = safeNextPath(new URLSearchParams(i.search).get("redirect_url"));
    return next ? { redirect: null, setCookies: [nextCookieHeader(next, { secure: i.secure })], skipMemberGate: false } : PASS;
  }

  const actValid = await verifyClaimCookie("act", i.cookie(ACT_COOKIE), i.clerkUserId, i.nowMs, secret);

  if (!isExempt(i.pathname) && md && md.onboarded !== true) {
    const onbValid = await verifyClaimCookie("onb", i.cookie(ONB_COOKIE), i.clerkUserId, i.nowMs, secret);
    if (!onbValid) {
      const here = safeNextPath(`${i.pathname}${i.search}`);
      const target = here ? `${ONBOARDING_ROOT}?redirect_url=${encodeURIComponent(here)}` : ONBOARDING_ROOT;
      return { redirect: target, setCookies: here ? [nextCookieHeader(here, { secure: i.secure })] : [], skipMemberGate: false };
    }
  }

  return actValid ? { redirect: null, setCookies: [], skipMemberGate: true } : PASS;
}
