// Socket token v2 (phase-02 plan §7.1.7, §7.4.2). Minted by the web app (GET /api/socket-token and RealtimeBoot),
// verified by the socket server at the handshake and on `session:refresh_token`. This file replaces the byte-for-byte
// copies in apps/web/lib/socket-token.ts and apps/web-socket/utils/socketAuth.ts. Server-only (node:crypto).
//
// wire: base64url(JSON(claims)) + "." + base64url(HMAC_SHA256(SOCKET_TOKEN_SECRET[kid], base64url(JSON(claims))))
// SOCKET_TOKEN_SECRET uses the INTERNAL_API_SECRET key-ring format ("kid:base64[,kid:base64]", first signs); it
// never verifies service calls, and INTERNAL_API_SECRET never verifies user tokens (architecture X16).
import { z } from "zod";
import { AppEnv } from "../http/system";
import { hmacBase64Url, type KeyRing, parseKeyRing, safeEqual } from "../internal/auth";
import { Ref } from "./game";
import { DISPLAY_NAME_MAX, SOCKET_TOKEN_MAX_CHARS, SOCKET_TOKEN_SKEW_SEC, SOCKET_TOKEN_TTL_SEC } from "./limits";

export { type KeyRing } from "../internal/auth";

/**
 * `env` uses the app's APP_ENV values (`dev`, `production`, `test`, `local`; http/system.ts). The plan's sketch
 * listed `ci`; CI runs with APP_ENV=test, so `test` is the env that admits `e2eRun`.
 */
export const SocketTokenEnv = AppEnv;
export type SocketTokenEnv = z.infer<typeof SocketTokenEnv>;

export const SocketTokenClaims = z.strictObject({
  v: z.literal(2),
  /** User referenceId: the only identity the socket trusts. */
  sub: Ref,
  /** Unix seconds; exp − iat ≤ SOCKET_TOKEN_TTL_SEC. */
  iat: z.number().int().min(0),
  exp: z.number().int().min(0),
  env: SocketTokenEnv,
  /** Entitled until (unix s); 0 = not a member. */
  ent: z.number().int().min(0),
  role: z.enum(["user", "admin"]),
  /** Display name for PlayerView without a DB read. */
  name: z.string().max(DISPLAY_NAME_MAX),
  kid: z.string().regex(/^[a-z0-9]{1,8}$/),
  /** APP_ENV=test only (refused at verify otherwise): isolates the legacy matchmaking pool per Playwright test. */
  e2eRun: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
});
export type SocketTokenClaims = z.infer<typeof SocketTokenClaims>;

/** A bare (pre-ring) SOCKET_TOKEN_SECRET value is read under this kid. */
export const SOCKET_TOKEN_BARE_KID = "s0";

/** Parses SOCKET_TOKEN_SECRET (or, on dev during the WP-D rollout only, the old shared secret). */
export function parseSocketKeyRing(raw: string | undefined | null): KeyRing {
  return parseKeyRing(raw, { bareKid: SOCKET_TOKEN_BARE_KID });
}

/** Signs complete claims. `claims.kid` must name a key of the ring. Throws on invalid claims or a missing key. */
export function signSocketToken(claims: SocketTokenClaims, keys: KeyRing): string {
  const parsed = SocketTokenClaims.parse(claims);
  const key = keys.keys.get(parsed.kid);
  if (!key) throw new Error("signSocketToken: no key for kid (SOCKET_TOKEN_SECRET)");
  if (parsed.exp - parsed.iat > SOCKET_TOKEN_TTL_SEC || parsed.exp <= parsed.iat) {
    throw new Error("signSocketToken: lifetime must be within (0, 15 min]");
  }
  if (parsed.e2eRun !== undefined && parsed.env !== "test") throw new Error("signSocketToken: e2eRun is for env test only");
  const payload = Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url");
  return `${payload}.${hmacBase64Url(key, payload)}`;
}

export type MintInput = Omit<SocketTokenClaims, "v" | "iat" | "exp" | "kid"> & { ttlSec?: number };

/** Fills `v`, `iat`, `exp` and `kid` (the ring's signing kid) and signs. `expiresAt` is unix seconds (= `claims.exp`, the wire shape of `SocketTokenData`). */
export function mintSocketToken(
  input: MintInput,
  keys: KeyRing,
  nowMs: number,
): { token: string; expiresAt: number; claims: SocketTokenClaims } {
  const { ttlSec = SOCKET_TOKEN_TTL_SEC, ...rest } = input;
  const kid = keys.signingKid;
  if (!kid) throw new Error("mintSocketToken: SOCKET_TOKEN_SECRET has no key");
  const iat = Math.floor(nowMs / 1000);
  const claims: SocketTokenClaims = { v: 2, ...rest, iat, exp: iat + Math.min(ttlSec, SOCKET_TOKEN_TTL_SEC), kid };
  return { token: signSocketToken(claims, keys), expiresAt: claims.exp, claims };
}

export type VerifyFailReason = "malformed" | "unknown_kid" | "bad_sig" | "invalid_claims" | "expired" | "not_yet_valid" | "ttl" | "env" | "e2e_run";

/**
 * Verifies a token. Null for anything wrong; never throws. `nowMs` is epoch ms; `env` is this server's APP_ENV.
 * Checks: shape and size, kid in the ring, HMAC (timing-safe), strict claims (v = 2), exp > now, iat ≤ now + skew,
 * exp − iat ≤ 15 min, env match, `e2eRun` only when env is `test`.
 */
export function verifySocketToken(token: unknown, keys: KeyRing, nowMs: number, env: SocketTokenEnv): SocketTokenClaims | null {
  const result = verifySocketTokenDetailed(token, keys, nowMs, env);
  return result.ok ? result.claims : null;
}

/** Same as verifySocketToken with the failure reason (for metrics and logs; never sent to the client). */
export function verifySocketTokenDetailed(
  token: unknown,
  keys: KeyRing,
  nowMs: number,
  env: SocketTokenEnv,
): { ok: true; claims: SocketTokenClaims } | { ok: false; reason: VerifyFailReason } {
  if (typeof token !== "string" || token.length > SOCKET_TOKEN_MAX_CHARS) return { ok: false, reason: "malformed" };
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return { ok: false, reason: "malformed" };
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return { ok: false, reason: "malformed" };

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  // The kid is read before the signature check only to pick the key; nothing else is trusted until it verifies.
  const kid = raw && typeof raw === "object" ? (raw as { kid?: unknown }).kid : undefined;
  const key = typeof kid === "string" ? keys.keys.get(kid) : undefined;
  if (!key) return { ok: false, reason: "unknown_kid" };
  if (!safeEqual(hmacBase64Url(key, payload), sig)) return { ok: false, reason: "bad_sig" };

  const parsed = SocketTokenClaims.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid_claims" };
  const claims = parsed.data;
  const nowSec = Math.floor(nowMs / 1000);
  if (claims.exp <= nowSec) return { ok: false, reason: "expired" };
  if (claims.iat > nowSec + SOCKET_TOKEN_SKEW_SEC) return { ok: false, reason: "not_yet_valid" };
  if (claims.exp - claims.iat > SOCKET_TOKEN_TTL_SEC) return { ok: false, reason: "ttl" };
  if (claims.env !== env) return { ok: false, reason: "env" };
  if (claims.e2eRun !== undefined && env !== "test") return { ok: false, reason: "e2e_run" };
  return { ok: true, claims };
}
