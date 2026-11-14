// Phase 5 feature flags (phase-05 plan §7.9). Client-safe data: no imports, no env reads.
//
// Each flag needs a PostHog flag of the same key. On dev they are turned on per user in PostHog (the owner, E2E users
// A–P and the lease pool; `bank-remove` the owner only); e2e runs turn them on with FLAGS_OVERRIDE
// ("train:on,home:on,bank-remove:on"), and P1's `flags-off` Playwright project runs the P1–P4 @smoke specs with
// `train` and `home` off until the flags are deleted (one release after 100 % in production, alloc §1.6).
// Flags never gate authorisation: every route still checks membership and ownership (arch §3.5.2). The puzzle kill
// switch is the env switch PUZZLES_ENABLED (lib/test-hooks/registry.ts KILL_SWITCHES), not a flag.

export const P05_FLAGS = {
  /**
   * Off: the Train destination and its subs are hidden, `/train/**` pages 404, Review complete shows no bank lines or
   * Drill CTA, the game-over `bank` slot renders nothing, the review bank fields are absent (`bank: null`, `inBank`
   * from `bankOptOut` only) and A6 writes P3's opt-out only. The worker's extraction is not flag-gated (data accrues dark).
   */
  train: { default: { dev: false, test: false, production: false, local: false } },
  /** Off: `/home` redirects to `/play`, the logo and the signed-in `/` keep their P4 targets. */
  home: { default: { dev: false, test: false, production: false, local: false } },
  /** The bank row's ⋯ Remove From Bank (W6, Undo 6 s). No design board yet (D-2): owner only until signed off. */
  "bank-remove": { default: { dev: false, test: false, production: false, local: false } },
} as const;
