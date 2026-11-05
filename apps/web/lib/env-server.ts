// Server-side environment fences for test hooks (plan §11.2 H9, §11.6, P1-13).
//
// Self-contained on purpose: it reads process.env directly and imports nothing,
// so the `main` cherry-pick of the hotfix lane does not depend on `lib/env.ts`.
//
// VERCEL_ENV is never consulted: the dev project `replay-chess-dev` deploys with
// VERCEL_ENV=production, so a VERCEL_ENV fence would lock hooks out of dev.

type Env = Readonly<Record<string, string | undefined>>;

/** App environments in which test hooks may run. */
const HOOK_APP_ENVS: ReadonlySet<string> = new Set(["dev", "test"]);

/**
 * True only when `NEXT_PUBLIC_APP_ENV` is `dev` or `test` AND `ALLOW_TEST_HOOKS=1`.
 * With neither variable set (the live project today) every hook is off.
 */
export function testHooksEnabled(env: Env = process.env): boolean {
  const appEnv = env.NEXT_PUBLIC_APP_ENV;
  return appEnv !== undefined && HOOK_APP_ENVS.has(appEnv) && env.ALLOW_TEST_HOOKS === "1";
}

// The one `isNonProdApp()` guard lives in lib/billing/products.ts (registry GUARD_SOURCES); don't add another here.
