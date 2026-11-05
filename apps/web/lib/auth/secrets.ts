import { timingSafeEqual } from "node:crypto";
import { testHooksEnabled } from "../env-server";

/**
 * Constant-time comparison of a presented token with a configured secret
 * (plan §11.2 H9, AA F-25). Every place that compares a secret uses this.
 *
 * False when either side is missing or empty, or when the lengths differ
 * (`timingSafeEqual` throws on unequal lengths, so that case is checked first;
 * it reveals only the length, which is not secret).
 */
export function tokenMatchesSecret(
  token: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  if (!token || !secret) return false;
  const tokenBytes = Buffer.from(token);
  const secretBytes = Buffer.from(secret);
  if (tokenBytes.length !== secretBytes.length) return false;
  return timingSafeEqual(tokenBytes, secretBytes);
}

/**
 * Compares an `Authorization: Bearer <secret>` header value in constant time.
 * The scheme is matched case-insensitively, as RFC 9110 allows.
 */
export function bearerMatchesSecret(
  authorization: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  if (!authorization) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return tokenMatchesSecret(match?.[1], secret);
}

/**
 * The k6 perf bypass (AA F-11, plan §11.2 H9, §11.6). Honoured only when all three hold:
 * `PERF_AUTH_BYPASS=true`, `testHooksEnabled()` (dev or test build with `ALLOW_TEST_HOOKS=1`;
 * never `VERCEL_ENV`), and the request's `x-perf-token` equals `PERF_TOKEN` (timing-safe).
 * Both the identity bypass (resolve-user.ts) and the paywall bypass (require-subscription.ts) use it.
 */
export function isPerfBypassRequest(
  request: { headers: Headers },
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (env.PERF_AUTH_BYPASS !== "true") return false;
  if (!testHooksEnabled(env)) return false;
  return tokenMatchesSecret(request.headers.get("x-perf-token"), env.PERF_TOKEN);
}
