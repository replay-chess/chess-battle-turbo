import { timingSafeEqual } from "node:crypto";

/**
 * Server-to-server auth for the socket server's `/internal/*` HTTP routes
 * (plan §7.5 #5, AS F-06). The web app sends `x-internal-token` with the shared
 * INTERNAL_API_SECRET; the web side does the same check with
 * `apps/web/lib/auth/secrets.ts#tokenMatchesSecret`. Whichever long-term scheme
 * the owner picks (Q-18) replaces both helpers in one change.
 */

/** Header the web app sends on every internal call. */
export const INTERNAL_TOKEN_HEADER = "x-internal-token";

/**
 * Constant-time comparison of a presented token with the configured secret.
 *
 * False when either side is missing or empty, or when the lengths differ
 * (`timingSafeEqual` throws on unequal lengths, so that case is checked first;
 * it reveals only the length, which is not secret). Never throws.
 */
export function verifyInternalToken(
  token: unknown,
  secret: string | undefined = process.env.INTERNAL_API_SECRET,
): boolean {
  if (typeof token !== "string" || token.length === 0 || !secret) return false;
  const tokenBytes = Buffer.from(token, "utf8");
  const secretBytes = Buffer.from(secret, "utf8");
  if (tokenBytes.length !== secretBytes.length) return false;
  return timingSafeEqual(tokenBytes, secretBytes);
}
