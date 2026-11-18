// The state names of the /dev/ui/weakness demo (phase-06 plan §4.1): WP1's fixture states plus the view states the plan
// names. Data only (no fixture import), so the server page and the Playwright device specs can read the list.

/** WP1's fixture states (`__fixtures__/payloads.ts` WEAKNESS_FIXTURE_STATES; demo-states.test.ts keeps them equal). */
export const WEAKNESS_FIXTURE_STATE_NAMES = [
  "ready",
  "ready_updating",
  "few_patterns",
  "none_eligible",
  "no_band",
  "no_clock",
  "insufficient_zero",
  "insufficient_few",
  "insufficient",
  "bullet_offer",
  "computing",
  "computing_stalled",
  "computing_orphaned",
  "computing_almost",
  "failed",
  "paused",
] as const;

/** The demo states: every fixture state plus the view states the plan names (§4.4–§4.9). */
export const WEAKNESS_DEMO_STATES = [
  ...WEAKNESS_FIXTURE_STATE_NAMES,
  "see_all",
  "tab_clock",
  "tab_openings",
  "tab_strengths",
  "drill",
  "drill_size20",
  "drill_mix_off",
  "drill_time_pressure",
  "drill_unmatched",
  "drill_zero_own",
  "drill_empty",
  "drill_starting",
  "drill_rate_limited",
  "ready_flash",
  "failed_again",
  "failed_rate_limited",
  "loading",
] as const;
export type WeaknessDemoState = (typeof WEAKNESS_DEMO_STATES)[number];
