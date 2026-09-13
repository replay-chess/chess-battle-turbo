import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived, signed tokens that let the WebSocket server verify which user a
 * socket belongs to.
 *
 * Format: `base64url(payload).base64url(hmac)` where payload is the JSON
 * `{ sub: userReferenceId, exp: unixSeconds }` and the HMAC is SHA-256 keyed
 * with INTERNAL_API_SECRET (already shared by apps/web and apps/web-socket).
 *
 * The verification half of this file is duplicated byte-for-byte in logic at
 * apps/web-socket/utils/socketAuth.ts because the two apps do not share code.
 * Keep the two in sync.
 */

export const SOCKET_TOKEN_TTL_SECONDS = 15 * 60;

export interface SocketTokenPayload {
  /** The user's referenceId. */
  sub: string;
  /** Expiry, unix seconds. */
  exp: number;
}

export interface SignSocketTokenOptions {
  userReferenceId: string;
  secret: string;
  /** Current time in unix seconds. Defaults to `Date.now() / 1000`. */
  now?: number;
  /** Token lifetime in seconds. Defaults to 15 minutes. */
  ttlSeconds?: number;
}

export interface SignedSocketToken {
  token: string;
  /** Expiry, unix seconds. */
  expiresAt: number;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function hmacBase64Url(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function signSocketToken({
  userReferenceId,
  secret,
  now = nowSeconds(),
  ttlSeconds = SOCKET_TOKEN_TTL_SECONDS,
}: SignSocketTokenOptions): SignedSocketToken {
  if (!secret) throw new Error("signSocketToken: secret is required");
  if (!userReferenceId) throw new Error("signSocketToken: userReferenceId is required");

  const expiresAt = Math.floor(now) + Math.floor(ttlSeconds);
  const payload: SocketTokenPayload = { sub: userReferenceId, exp: expiresAt };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = hmacBase64Url(encodedPayload, secret);

  return { token: `${encodedPayload}.${signature}`, expiresAt };
}

/**
 * Verify a token produced by `signSocketToken`.
 *
 * Returns the user referenceId when the signature matches and the token has
 * not expired; `null` for anything else (malformed, tampered, expired, wrong
 * secret). Never throws.
 */
export function verifySocketToken(
  token: unknown,
  secret: string | undefined,
  now: number = nowSeconds(),
): { userReferenceId: string } | null {
  if (typeof token !== "string" || !secret) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return null;

  const expected = hmacBase64Url(encodedPayload, secret);
  const expectedBytes = Buffer.from(expected, "utf8");
  const signatureBytes = Buffer.from(signature, "utf8");
  if (expectedBytes.length !== signatureBytes.length) return null;
  if (!timingSafeEqual(expectedBytes, signatureBytes)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;

  const { sub, exp } = payload as Partial<SocketTokenPayload>;
  if (typeof sub !== "string" || sub.length === 0) return null;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  if (exp <= now) return null;

  return { userReferenceId: sub };
}
