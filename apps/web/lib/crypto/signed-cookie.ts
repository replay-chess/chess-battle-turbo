// HMAC-signed cookie values (phase-04 plan §8.14, D4-16, D4-29): `rc_lichess_pkce` (OAuth start → callback),
// `rc_onb`, `rc_act`, `rc_onb_next` (middleware hints). Format `<payload>.<sig>`:
//   payload = base64url(JSON {v: 1, exp, sub?, …})
//   sig     = base64url(HMAC-SHA256(SIGNED_COOKIE_SECRET, payload))
// Web Crypto only (crypto.subtle), so the same code runs in route handlers (Node) and in middleware (Edge). The
// signature check is `crypto.subtle.verify` (constant time). A value is accepted only when the signature matches,
// `exp` is in the future and, when the caller names a subject, `sub` equals it (a cookie minted for one Clerk user
// is useless to another). Nothing secret goes into a payload: it is signed, not encrypted.

type Env = Readonly<Record<string, string | undefined>>;

/** HMAC keys shorter than this are refused (32 random bytes hex-encoded are 64 chars). */
export const SIGNED_COOKIE_SECRET_MIN_CHARS = 32;
/** A cookie value never exceeds this (browsers cap a cookie at 4 KiB). */
export const SIGNED_COOKIE_MAX_CHARS = 3_000;

export type SignedPayload = { v: 1; exp: number; sub?: string } & Record<string, unknown>;

export type VerifyFailure = "malformed" | "bad_sig" | "expired" | "wrong_subject";
export type VerifyResult<T> = { ok: true; payload: T } | { ok: false; reason: VerifyFailure };

/** SIGNED_COOKIE_SECRET, or null when unset / too short (callers treat that as "not configured"). */
export function signedCookieSecret(env: Env = process.env): string | null {
  const raw = env.SIGNED_COOKIE_SECRET?.trim();
  return raw && raw.length >= SIGNED_COOKIE_SECRET_MIN_CHARS ? raw : null;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return toBase64Url(bytes);
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    keyCache.set(secret, key);
  }
  return key;
}

/** `<payload>.<sig>` for a payload with `v: 1` and `exp` (epoch ms). */
export async function signCookieValue(payload: SignedPayload, secret: string): Promise<string> {
  if (payload.v !== 1 || !Number.isFinite(payload.exp)) throw new TypeError("signed cookie payload needs v: 1 and a finite exp");
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body)));
  const value = `${body}.${toBase64Url(sig)}`;
  if (value.length > SIGNED_COOKIE_MAX_CHARS) throw new RangeError("signed cookie value is too large");
  return value;
}

/** Checks the signature, `exp` (against `nowMs`) and, when given, the subject. Never throws for a bad value. */
export async function verifyCookieValue<T extends SignedPayload = SignedPayload>(
  value: string | null | undefined,
  secret: string,
  options: { nowMs: number; sub?: string },
): Promise<VerifyResult<T>> {
  if (!value || value.length > SIGNED_COOKIE_MAX_CHARS) return { ok: false, reason: "malformed" };
  const dot = value.indexOf(".");
  if (dot <= 0 || dot !== value.lastIndexOf(".")) return { ok: false, reason: "malformed" };
  const body = value.slice(0, dot);
  const sig = fromBase64Url(value.slice(dot + 1));
  if (!sig || sig.length !== 32) return { ok: false, reason: "malformed" };
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, encoder.encode(body));
  if (!valid) return { ok: false, reason: "bad_sig" };
  const raw = fromBase64Url(body);
  if (!raw) return { ok: false, reason: "malformed" };
  let payload: unknown;
  try {
    payload = JSON.parse(decoder.decode(raw));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!payload || typeof payload !== "object" || (payload as SignedPayload).v !== 1) return { ok: false, reason: "malformed" };
  const p = payload as T;
  if (typeof p.exp !== "number" || !(p.exp > options.nowMs)) return { ok: false, reason: "expired" };
  if (options.sub !== undefined && p.sub !== options.sub) return { ok: false, reason: "wrong_subject" };
  return { ok: true, payload: p };
}

export type CookieOptions = {
  maxAgeSec: number;
  path?: string;
  httpOnly?: boolean;
  /** Default true. Browsers accept Secure cookies on http://localhost, so local and e2e runs keep it. */
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
};

const COOKIE_NAME_RE = /^[A-Za-z0-9_-]+$/;

/** One `Set-Cookie` header value. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  if (!COOKIE_NAME_RE.test(name)) throw new TypeError(`bad cookie name ${name}`);
  if (!/^[A-Za-z0-9._~-]*$/.test(value)) throw new TypeError("cookie values must be base64url/dot text");
  const parts = [`${name}=${value}`, `Path=${options.path ?? "/"}`, `Max-Age=${Math.max(0, Math.floor(options.maxAgeSec))}`];
  if (options.httpOnly ?? true) parts.push("HttpOnly");
  if (options.secure ?? true) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  return parts.join("; ");
}

/** A `Set-Cookie` value that deletes the cookie (same name and path). */
export function clearCookie(name: string, options: Pick<CookieOptions, "path" | "secure" | "sameSite"> = {}): string {
  return serializeCookie(name, "", { ...options, maxAgeSec: 0 });
}

/** The value of one cookie from a `Cookie` header (first match), or null. */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
