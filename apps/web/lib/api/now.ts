// Request time (plan §7.2 step 2b, CT X5). ctx.now is Date.now(), or the epoch ms in x-rc-now when test hooks are on
// AND x-e2e-token equals E2E_TEST_TOKEN (timing-safe). In production (hooks off) both headers are ignored.
import { cache } from "react";
import { tokenMatchesSecret } from "@/lib/auth/secrets";
import { testHooksEnabled } from "@/lib/env-server";

export const RC_NOW_HEADER = "x-rc-now";
export const E2E_TOKEN_HEADER = "x-e2e-token";

type Env = Readonly<Record<string, string | undefined>>;
type HeaderBag = Pick<Headers, "get">;

/** Inclusive bounds for an accepted x-rc-now (year 2000 to 2100), so a typo can't produce an absurd clock. */
const MIN_MS = 946_684_800_000;
const MAX_MS = 4_102_444_800_000;

/** The overridden time from the headers, or null when the override is not allowed or not usable. */
export function overriddenNow(headers: HeaderBag, env: Env = process.env): Date | null {
  if (!testHooksEnabled(env)) return null;
  const raw = headers.get(RC_NOW_HEADER);
  if (!raw) return null;
  if (!tokenMatchesSecret(headers.get(E2E_TOKEN_HEADER), env.E2E_TEST_TOKEN)) return null;
  if (!/^\d{1,16}$/.test(raw.trim())) return null;
  const ms = Number(raw.trim());
  if (ms < MIN_MS || ms > MAX_MS) return null;
  return new Date(ms);
}

/** ctx.now for one request. */
export function resolveNow(headers: HeaderBag, env: Env = process.env, clock: () => number = Date.now): Date {
  return overriddenNow(headers, env) ?? new Date(clock());
}

/**
 * The same rule for server components and services outside route() (getViewer, getShellSession): one value per
 * request through React cache(). Reads next/headers lazily so this module stays importable from plain Node tests.
 */
export const requestNow = cache(async (): Promise<Date> => {
  try {
    const { headers } = await import("next/headers");
    return resolveNow(await headers());
  } catch {
    // Outside a request scope (scripts, tests): the wall clock.
    return new Date();
  }
});
