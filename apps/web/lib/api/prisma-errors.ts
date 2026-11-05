// Central Prisma error mapping (plan §7.2 step 7). Reads the error code duck-typed, so it works for
// PrismaClientKnownRequestError (`code`) and PrismaClientInitializationError (`errorCode`) without importing the client.
//
// | P2002       | 409 conflict { target }             |
// | P2025       | 404 not_found                       |
// | P2024/P2028 | 503 unavailable, retryAfterSec 2    |
// | P1001/P1017 | GET: one retry after 300 ms; then 503 unavailable |
import { ApiError } from "./api-error";

export const CONNECTION_RETRY_DELAY_MS = 300;
export const UNAVAILABLE_RETRY_AFTER_SEC = 2;

const CONNECTION_CODES: ReadonlySet<string> = new Set(["P1001", "P1017"]);
const POOL_CODES: ReadonlySet<string> = new Set(["P2024", "P2028"]);

/** The Prisma error code (P1001, P2002, …) of a thrown value, or null. */
export function prismaCodeOf(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: unknown; errorCode?: unknown };
  for (const value of [e.code, e.errorCode]) {
    if (typeof value === "string" && /^P\d{4}$/.test(value)) return value;
  }
  return null;
}

/** True for "can't reach the database" / "server closed the connection": worth one retry on a GET. */
export function isRetryableConnectionError(err: unknown): boolean {
  const code = prismaCodeOf(err);
  return code !== null && CONNECTION_CODES.has(code);
}

function targetOf(err: unknown): string[] | undefined {
  const meta = (err as { meta?: { target?: unknown } }).meta;
  const target = meta?.target;
  if (Array.isArray(target)) return target.filter((t): t is string => typeof t === "string");
  if (typeof target === "string") return [target];
  return undefined;
}

/** The ApiError for a Prisma error, or null when the value is not one we map. */
export function mapPrismaError(err: unknown): ApiError | null {
  const code = prismaCodeOf(err);
  if (!code) return null;
  if (code === "P2002") {
    const target = targetOf(err);
    return new ApiError("conflict", { details: target ? { target } : undefined, cause: err });
  }
  if (code === "P2025") return new ApiError("not_found", { cause: err });
  if (POOL_CODES.has(code) || CONNECTION_CODES.has(code)) {
    return new ApiError("unavailable", { retryAfterSec: UNAVAILABLE_RETRY_AFTER_SEC, cause: err });
  }
  return null;
}

/**
 * Runs fn; for a GET, one retry after 300 ms when the first attempt fails with P1001/P1017 (Neon waking up, a dropped
 * pooled connection). Non-GETs never retry: the first attempt may have committed.
 */
export async function withConnectionRetry<T>(
  method: string,
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (method !== "GET" || !isRetryableConnectionError(err)) throw err;
    await sleep(CONNECTION_RETRY_DELAY_MS);
    return fn();
  }
}
