// The member landing rule (phase-05 plan §3.1 `middleware.ts`, §4.8; interface check §0.6). A signed-in member who
// opens `/` lands on `/home`. Middleware decides from the Clerk session claims alone (`sessionClaims.md`, read
// locally from the session cookie): no database call and no flag lookup, because flags are server-only and cannot
// run in middleware. The `home` flag is enforced by `/home` itself (off → `/play`, the §13.4 rollback).
//
// Pure, so every case is unit-tested; middleware.ts holds one P5 block that calls it for `pathname === "/"` only.
import type { RcPublicMetadata } from "@/lib/auth/claims";

export const HOME_PATH = "/home";
export const LANDING_PATH = "/";

/**
 * `/home` when the claims say the viewer is an onboarded member (entitled; an admin; or any onboarded viewer while
 * the paywall is off), else null (the marketing page renders). Unknown claims (never synced, malformed) are not a
 * member: the page stays public rather than bouncing someone who may not be one.
 */
export function landingTarget(md: unknown, env: Readonly<Record<string, string | undefined>> = {}): string | null {
  if (!md || typeof md !== "object" || Array.isArray(md)) return null;
  const c = md as Partial<RcPublicMetadata>;
  if (c.onboarded !== true) return null;
  const paywallOff = env.BILLING_PAYWALL?.trim().toLowerCase() === "off";
  if (c.entitled === true || c.role === "ADMIN" || paywallOff) return HOME_PATH;
  return null;
}

/** The landing page itself (a query such as `?utm_source=` does not change it). */
export function isLandingPath(pathname: string): boolean {
  return pathname === LANDING_PATH;
}
