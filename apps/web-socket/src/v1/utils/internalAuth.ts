import { timingSafeEqual } from "node:crypto";

/**
 * v1 only (deleted with `src/v1/` at the parity gate, phase-02 plan 7.5.1 "Never the static token").
 *
 * The v1 path still talks to the web app's internal chess routes with the static `x-internal-token`, accepts the
 * same token on the legacy `/internal/tournament-event`, and verifies v1 user tokens (`{sub, exp}`) with it. The web
 * app compares that header with its OWN INTERNAL_API_SECRET string, verbatim (lib/auth/internal.ts,
 * lib/auth/resolve-user.ts, game-by-ref), so the value sent here must equal the web's INTERNAL_API_SECRET exactly:
 *   1. LEGACY_INTERNAL_API_SECRET when set (set it to the web's INTERNAL_API_SECRET, character for character);
 *   2. else INTERNAL_API_SECRET when it is still a bare (non-ring) value (the pre-P2 shared secret);
 *   3. else, when INTERNAL_API_SECRET is a ring, its `web:` entry as written (`web:<base64>`), which is exactly the
 *      web's INTERNAL_API_SECRET when the web holds the single `web` key (the dev and CI setup).
 * FIX-A: before (3) existed, switching the web to `web:<key>` while the socket's LEGACY still held the old bare value
 * made every v1 persistence call (chess/move, game-over, game-state, game-by-ref) return 401.
 */

/** Header the web app sends on every internal call. */
export const INTERNAL_TOKEN_HEADER = "x-internal-token";

const RING_ENTRY = /^[a-z0-9]{1,8}:/;

/** The bare legacy secret, or "" when none is configured. Read at call time (tests set env late). */
export function legacySecret(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const explicit = env.LEGACY_INTERNAL_API_SECRET?.trim();
  if (explicit) return explicit;
  const shared = env.INTERNAL_API_SECRET?.trim() ?? "";
  if (!shared) return "";
  if (!RING_ENTRY.test(shared)) return shared;
  const webEntry = shared
    .split(",")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("web:") && entry.length > "web:".length);
  return webEntry ?? "";
}

/**
 * Constant-time comparison of a presented token with the legacy secret.
 *
 * False when either side is missing or empty, or when the lengths differ (`timingSafeEqual` throws on unequal
 * lengths, so that case is checked first; it reveals only the length, which is not secret). Never throws.
 */
export function verifyInternalToken(token: unknown, secret: string | undefined = legacySecret()): boolean {
  if (typeof token !== "string" || token.length === 0 || !secret) return false;
  const tokenBytes = Buffer.from(token, "utf8");
  const secretBytes = Buffer.from(secret, "utf8");
  if (tokenBytes.length !== secretBytes.length) return false;
  return timingSafeEqual(tokenBytes, secretBytes);
}
