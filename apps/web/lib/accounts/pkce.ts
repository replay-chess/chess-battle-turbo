// PKCE (RFC 7636, S256) and the OAuth `state` for the Lichess link (phase-04 plan §7.3.4, §8.14).
//   verifier  = base64url(48 random bytes)  → 64 chars of [A-Za-z0-9-_] (inside RFC 7636's unreserved set, 43–128)
//   challenge = base64url(SHA-256(verifier))
//   state     = base64url(24 random bytes)  → 32 chars
// Web Crypto only, so it runs anywhere the route handler does.
import { base64UrlEncode } from "@/lib/crypto/signed-cookie";

export const PKCE_VERIFIER_BYTES = 48;
export const OAUTH_STATE_BYTES = 24;
/** RFC 7636 §4.1: unreserved characters, 43–128 long. */
export const PKCE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

function randomBase64Url(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

export function newPkceVerifier(): string {
  return randomBase64Url(PKCE_VERIFIER_BYTES);
}

export function newOAuthState(): string {
  return randomBase64Url(OAUTH_STATE_BYTES);
}

/** S256 code challenge of a verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  if (!PKCE_VERIFIER_RE.test(verifier)) throw new RangeError("not a PKCE code verifier");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** Constant-time string equality (the callback's `state` check). */
export function timingSafeEqualText(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}
