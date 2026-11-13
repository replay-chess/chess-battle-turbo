// The two short-lived claim cookies that bridge Clerk's JWT lag (phase-04 plan D4-16, §8.14, §11.2):
//
//   rc_onb  set by PATCH /api/me/onboarding {complete} (WP-F): "this user just finished onboarding"
//   rc_act  set by GET /api/billing/activation when it answers active (WP-D): "this user is entitled now"
//
// Middleware honours them for 120 s, until the refreshed session token carries the new `md` claims. Each value is
// `<payload>.<sig>`: payload = base64url(JSON {v:1, k, u, exp}), sig = base64url(HMAC-SHA256(SIGNED_COOKIE_SECRET,
// "<cookie name>.<payload>")). Bound to the Clerk user id (`u`) and the cookie kind (`k` and the signed name), so a
// cookie copied to another account or renamed does not verify. Web Crypto only: the same code runs in middleware
// (Edge) and in route handlers (Node 22). APIs never trust these cookies; they read the database.

export const ONB_COOKIE = "rc_onb";
export const ACT_COOKIE = "rc_act";
/** Lifetime of rc_onb / rc_act (seconds). */
export const CLAIM_COOKIE_MAX_AGE_SEC = 120;
/** SIGNED_COOKIE_SECRET must be at least this long (32 random bytes hex = 64 chars; 32 is the floor). */
export const SIGNED_COOKIE_SECRET_MIN = 32;

export type ClaimCookieKind = "onb" | "act";

const NAME: Record<ClaimCookieKind, string> = { onb: ONB_COOKIE, act: ACT_COOKIE };

type Env = Readonly<Record<string, string | undefined>>;

/** The signing secret, or null when it is missing or too short (then nothing is signed and nothing verifies). */
export function claimCookieSecret(env: Env = process.env): string | null {
  const s = env.SIGNED_COOKIE_SECRET?.trim();
  return s && s.length >= SIGNED_COOKIE_SECRET_MIN ? s : null;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    if (keys.size > 4) keys.clear();
    keys.set(secret, key);
  }
  return key;
}

type Payload = { v: 1; k: ClaimCookieKind; u: string; exp: number };

/** A signed cookie value for `kind`, valid until `nowMs + maxAgeSec`. */
export async function signClaimCookie(
  kind: ClaimCookieKind,
  clerkUserId: string,
  nowMs: number,
  secret: string,
  maxAgeSec: number = CLAIM_COOKIE_MAX_AGE_SEC,
): Promise<string> {
  const payload: Payload = { v: 1, k: kind, u: clerkUserId, exp: Math.floor(nowMs / 1000) + maxAgeSec };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(`${NAME[kind]}.${body}`));
  return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

/**
 * True when `value` is an unexpired `kind` cookie for this Clerk user, signed with `secret`. The signature check is
 * `crypto.subtle.verify` (constant time); the payload is read only after it passes.
 */
export async function verifyClaimCookie(
  kind: ClaimCookieKind,
  value: string | null | undefined,
  clerkUserId: string,
  nowMs: number,
  secret: string | null,
): Promise<boolean> {
  if (!secret || !value || value.length > 512 || !clerkUserId) return false;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot !== value.lastIndexOf(".")) return false;
  const body = value.slice(0, dot);
  const sig = fromBase64Url(value.slice(dot + 1));
  if (!sig || sig.length !== 32) return false;
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, encoder.encode(`${NAME[kind]}.${body}`));
  } catch {
    return false;
  }
  if (!ok) return false;
  const raw = fromBase64Url(body);
  if (!raw) return false;
  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(decoder.decode(raw)) as Partial<Payload>;
  } catch {
    return false;
  }
  return (
    payload.v === 1 &&
    payload.k === kind &&
    payload.u === clerkUserId &&
    typeof payload.exp === "number" &&
    payload.exp * 1000 > nowMs
  );
}

/** The Set-Cookie header for a claim cookie: HttpOnly, SameSite=Lax, Path=/, 120 s; Secure on https. */
export function claimSetCookie(kind: ClaimCookieKind, value: string, opts: { secure: boolean; maxAgeSec?: number }): string {
  const parts = [
    `${NAME[kind]}=${value}`,
    "Path=/",
    `Max-Age=${opts.maxAgeSec ?? CLAIM_COOKIE_MAX_AGE_SEC}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/** Whether cookies set for this request should carry `Secure` (https, or any deployed environment). */
export function cookieSecureFor(url: string, env: Env = process.env): boolean {
  if (url.startsWith("https:")) return true;
  return Boolean(env.VERCEL_ENV);
}
