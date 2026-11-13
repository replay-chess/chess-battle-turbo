// Pages outside /onboarding that a member-to-be must reach before finishing onboarding (phase-04 plan §8.1, D4-17):
// the checkout return and the settings pages. One list for the middleware rule (lib/onboarding/guard.ts) and the
// legacy client redirect in app/components/UserSync.tsx. Plain strings, no imports: safe in the root client bundle.

/** Path prefixes (each also matches its sub-paths). */
export const ONBOARDING_EXEMPT_PREFIXES = [
  "/onboarding",
  "/checkout/activating",
  "/settings/connected",
  "/settings/account",
  "/settings/membership",
] as const;

/** Whether `pathname` is one of the prefixes or below one. */
export function isOnboardingExemptPathname(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return ONBOARDING_EXEMPT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
