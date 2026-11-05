// Phase 1 feature flags (plan §7.10, decision P1-12). Client-safe data: no imports, no env reads.
// One file per phase (CF §7). A later phase adds lib/flags/registry/pNN.ts and one spread line in ./index.ts.
//
// Each flag needs a matching PostHog flag of the same key (owner, creation date and expiry in its
// PostHog description, architecture §3.5.2). `default` is used when PostHog has no answer: no keys,
// definitions not loaded yet, the 300 ms cap hit, or any error.

export const P01_FLAGS = {
  /** v3 app shell, rail and tab bar, ViewportStage. Off in production until P13. */
  "shell-v3": { default: { dev: true, test: true, production: false, local: true } },
} as const;
