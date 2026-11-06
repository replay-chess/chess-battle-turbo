import { createHmac, timingSafeEqual } from "node:crypto";
import type { Socket } from "socket.io";

/**
 * v1 user tokens (`{ sub, exp }` signed with the legacy shared secret), accepted only for sockets that connect
 * without `proto: 2` while PROTOCOL_V1=on (phase-02 plan 7.4.1 step 2). The v2 handshake (`src/server/handshake.ts`)
 * calls `verifyLegacySocketToken`; v2 tokens are verified with `@repo/contracts/socket/token`. Deleted with
 * `src/v1/` at the parity gate.
 *
 * Format: `base64url(payload).base64url(hmac)`; payload `{ sub: userReferenceId, exp: unixSeconds }`, HMAC-SHA256.
 */

interface LegacyTokenPayload {
  sub: string;
  exp: number;
}

function hmacBase64Url(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function verifyLegacySocketToken(
  token: unknown,
  secret: string | undefined,
  now: number = Math.floor(Date.now() / 1000),
): { userReferenceId: string } | null {
  if (typeof token !== "string" || !secret || token.length > 1024) return null;

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

  const { sub, exp } = payload as Partial<LegacyTokenPayload>;
  if (typeof sub !== "string" || sub.length === 0) return null;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  if (exp <= now) return null;

  return { userReferenceId: sub };
}

/** The user referenceId proven by the handshake (v1 sockets get it from the v2 handshake's v1 path). */
export function getVerifiedUserReferenceId(socket: Socket): string | undefined {
  const data = socket.data as { userRef?: unknown };
  return typeof data.userRef === "string" ? data.userRef : undefined;
}
