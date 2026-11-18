// Phase 6 feature flags (phase-06 plan §7.8; interface check §0.19). Client-safe data: no imports, no env reads.
//
// The PostHog flag `weakness` turns the Weakness Profile on per user (on dev: the owner, the E2E users and the lease
// pool); e2e runs turn it on with FLAGS_OVERRIDE ("weakness:on"), and the `flags-off` Playwright project keeps the off
// path tested until the flag is deleted (one release after 100 % in production, allocation §1.6). Flags never gate
// authorisation: every route still checks membership. The worker computes regardless (turning the flag on shows warm data).

export const P06_FLAGS = {
  /**
   * Off: `/train/weakness*` redirect to `/train`; TR-5, TR-12, TR-13 and TR-7 `kind:"weakness"` answer 404; the nav
   * sub-item, the `g w` chord and the ⌘K entry are hidden; the hub row, Home line and `badges.weaknessReady` are absent.
   */
  weakness: { default: { dev: false, test: false, production: false, local: false } },
} as const;
