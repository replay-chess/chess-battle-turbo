// Phase 3 feature flags (phase-03 plan §7.10). Client-safe data: no imports, no env reads.
//
// Each flag needs a PostHog flag of the same key. On dev, `review-v3` and `review-share` are turned on per user in
// PostHog (the owner and the shared E2E members); e2e runs turn them on with FLAGS_OVERRIDE
// ("review-v3:on,review-share:on"). Enqueueing analysis is never flagged: every finished game is graded either way.

export const P03_FLAGS = {
  /** The Review nav item, /review/*, /games, /practice, the game-over slots; reviewHref() → /review (else /analysis). */
  "review-v3": { default: { dev: false, test: false, production: false, local: false } },
  /** The share screen, its menu item and complete row, A10 (404 when off). A11 stays open to owners; /r/* is not flagged. */
  "review-share": { default: { dev: false, test: false, production: false, local: false } },
  /** B26: lapsed members may read reviews and the archive (GETs only). Off: owner decision P3-Q1. */
  "review-lapsed-read": { default: { dev: false, test: false, production: false, local: false } },
  /**
   * H3 (§13.2, P3-D30): `/analysis/<ref>` and `/api/analysis/<ref>` answer 308 to the review (R1) while the legacy code
   * is still present; off = the legacy page. Turned on for everyone on dev after the parity check; H4 deletes the code.
   */
  "analysis-redirect": { default: { dev: false, test: false, production: false, local: false } },
  /** The socket posts live positions to the worker for eval-cache prewarm (§9.7 stretch). */
  "analysis-live-prewarm": { default: { dev: false, test: false, production: false, local: false } },
} as const;
