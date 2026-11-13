// Phase 4 feature flags (phase-04 plan §7.10). Client-safe data: no imports, no env reads.
//
// Each flag needs a PostHog flag of the same key. On dev both are turned on per user in PostHog (the owner, E2E users
// A–R and the lease pool); e2e runs turn them on with FLAGS_OVERRIDE ("onboarding-v3:on,import-v3:on"). P1's
// `flags-off` Playwright project runs P1–P3's @smoke specs with both off until the legacy code is deleted (§12.6).

export const P04_FLAGS = {
  /**
   * Off: `/onboarding` renders the legacy page, the step routes 404 and checkout returns use the legacy paths.
   * On: the resolver and the eight step routes; checkout returns through buildActivationReturnUrl().
   */
  "onboarding-v3": { default: { dev: false, test: false, production: false, local: false } },
  /**
   * Off: `/api/accounts/*` and `/api/import/*` answer 404, `/settings/connected` 404s, the archive's source tabs are
   * hidden and the legacy chess-com routes stay active. On: everything in §7.
   */
  "import-v3": { default: { dev: false, test: false, production: false, local: false } },
} as const;
