import { createHmac, timingSafeEqual } from "node:crypto";
import type { Socket } from "socket.io";
import { logger } from "./logger";

/**
 * Verifies the short-lived user tokens issued by the web app
 * (GET /api/socket-token) and sent in the socket.io `auth.token` handshake.
 *
 * Format: `base64url(payload).base64url(hmac)` where payload is the JSON
 * `{ sub: userReferenceId, exp: unixSeconds }` and the HMAC is SHA-256 keyed
 * with INTERNAL_API_SECRET (shared by both apps).
 *
 * NOTE: `verifySocketToken` is a byte-for-byte copy in logic of
 * apps/web/lib/socket-token.ts#verifySocketToken. The two apps do not share
 * code, so any change there must be mirrored here (and vice versa).
 */

interface SocketTokenPayload {
  sub: string;
  exp: number;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function hmacBase64Url(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

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

/** Data attached to a socket by `socketAuthMiddleware`. */
export interface SocketAuthData {
  /** Set only when the handshake carried a valid token. */
  userReferenceId?: string;
}

/** When true, sockets without a valid token are rejected at the handshake. */
export function isSocketAuthRequired(): boolean {
  return process.env.SOCKET_AUTH_REQUIRED === "true";
}

/**
 * socket.io middleware (`io.use(socketAuthMiddleware)`).
 *
 * Reads `socket.handshake.auth.token`. A valid token pins the socket to a user
 * via `socket.data.userReferenceId`. A missing or invalid token is rejected
 * with `Error("unauthorized")` when SOCKET_AUTH_REQUIRED=true; otherwise the
 * socket is let through unauthenticated (logged once per socket) so clients
 * that predate token support keep working during the rollout.
 */
export function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void): void {
  const secret = process.env.INTERNAL_API_SECRET;
  const auth = socket.handshake.auth as { token?: unknown } | undefined;
  const token = auth?.token;

  if (!secret) {
    logger.warn("INTERNAL_API_SECRET is not set; socket tokens cannot be verified", { socket: socket.id });
  }

  const verified = verifySocketToken(token, secret);
  if (verified) {
    (socket.data as SocketAuthData).userReferenceId = verified.userReferenceId;
    next();
    return;
  }

  const reason = token === undefined || token === null || token === "" ? "missing" : "invalid";
  if (isSocketAuthRequired()) {
    logger.warn(`Rejecting socket with ${reason} auth token`, { socket: socket.id });
    next(new Error("unauthorized"));
    return;
  }

  logger.warn(`Socket connected with ${reason} auth token (SOCKET_AUTH_REQUIRED is off)`, {
    socket: socket.id,
  });
  next();
}

/** The user referenceId proven by the handshake token, if any. */
export function getVerifiedUserReferenceId(socket: Socket): string | undefined {
  return (socket.data as SocketAuthData).userReferenceId;
}

/**
 * True when the socket may act as `claimedUserReferenceId`.
 *
 * A socket that authenticated as user A may only act as A. A socket with no
 * verified identity (only possible while SOCKET_AUTH_REQUIRED is off) is
 * allowed through so that older clients keep working.
 */
export function socketMayActAs(socket: Socket, claimedUserReferenceId: string): boolean {
  const verified = getVerifiedUserReferenceId(socket);
  return verified === undefined || verified === claimedUserReferenceId;
}
