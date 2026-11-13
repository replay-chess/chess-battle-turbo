// Phase-04 plan 10.1 (TST X6): every onboarding event accepts its documented shape, refuses extra keys and PII, and
// the lists it repeats stay equal to the wire contract.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Drift guard only: the analytics package has no runtime dependency on the contracts package.
import {
  DAILY_MINUTES,
  LICHESS_ERROR_REASONS,
  ONBOARDING_GOALS,
  ONBOARDING_STEPS,
  PROVIDER_SLUGS,
  RATING_BANDS,
} from "../../../contracts/src/http/p04-plain";
import { FORBIDDEN_PROPERTY_NAMES, findPii } from "../pii";
import { billingEvents } from "./billing";
import { gameEvents } from "./game";
import { reviewEvents } from "./review";
import { shellEvents } from "./shell";
import { systemEvents } from "./system";
import {
  ONB_GOALS,
  ONB_LICHESS_REASONS,
  ONB_PROVIDERS,
  ONB_RATING_BANDS,
  ONB_STEPS,
  onboardingClientEvents,
  onboardingEvents,
  onboardingServerEvents,
} from "./onboarding";

const samples: { [K in keyof typeof onboardingEvents]: Record<string, unknown> } = {
  onb_step_viewed: { step: "welcome" },
  onb_step_completed: { step: "level", ms_on_step: 8_400 },
  onb_step_skipped: { step: "link" },
  onb_get_started_clicked: {},
  onb_link_lookup_submitted: { provider: "chesscom" },
  onb_link_lookup_result: { result: "found", ms: 640, is_cache_hit: false },
  onb_link_lichess_clicked: {},
  onb_link_lichess_result: { result: "denied", reason: "access_denied" },
  onb_confirm_viewed: { provider: "chesscom", games_bucket: "50-499" },
  onb_confirm_accepted: { provider: "lichess" },
  onb_confirm_not_me: { provider: "chesscom" },
  onb_level_selected: { band: "r800_1200", source: "suggested" },
  onb_goals_changed: { goals: ["stop_blundering", "study_legends"] },
  onb_minutes_changed: { minutes: 20 },
  onb_plan_viewed: { plan_default: "monthly", is_trial_eligible: true },
  onb_plan_toggled: { plan: "yearly" },
  onb_activating_continue_background: { source: "onboarding" },
  onb_completed: {
    total_ms: 95_000,
    linked_providers: ["chesscom"],
    rating_band: "r800_1200",
    goals: ["stop_blundering"],
    daily_minutes: 10,
    plan: "monthly",
    is_trial: true,
  },
  onb_done_cta_clicked: { cta: "home" },
  onb_import_retry_clicked: { provider: "chesscom" },
  onb_signed_out: { step: "plan" },
  onb_completed_server: { is_trial: false, linked_providers: ["chesscom", "lichess"] },
};

describe("onboarding events (phase-04 plan 10.1)", () => {
  for (const [name, schema] of Object.entries(onboardingEvents)) {
    const sample = samples[name as keyof typeof samples];
    it(`${name} accepts its documented shape and refuses extra keys`, () => {
      assert.ok(schema.safeParse(sample).success, name);
      assert.equal(schema.safeParse({ ...sample, extra: 1 }).success, false);
    });
  }

  it("no free text: a username, an email or a FEN never fits a property", () => {
    assert.equal(onboardingClientEvents.onb_link_lookup_result.safeParse({ result: "knightowl_88", ms: 1, is_cache_hit: false }).success, false);
    assert.equal(onboardingClientEvents.onb_link_lichess_result.safeParse({ result: "error", reason: "user@example.com" }).success, false);
    assert.equal(onboardingClientEvents.onb_step_viewed.safeParse({ step: "8/8/8/8/8/8/8/K6k w - - 0 1" }).success, false);
    for (const sample of Object.values(samples)) assert.deepEqual(findPii(sample), []);
    for (const schema of Object.values(onboardingEvents)) {
      for (const key of Object.keys(schema.shape)) assert.ok(!FORBIDDEN_PROPERTY_NAMES.includes(key as never), key);
    }
  });

  it("the lists equal the wire contract", () => {
    assert.deepEqual([...ONB_STEPS], [...ONBOARDING_STEPS]);
    assert.deepEqual([...ONB_RATING_BANDS], [...RATING_BANDS]);
    assert.deepEqual([...ONB_GOALS], [...ONBOARDING_GOALS]);
    assert.deepEqual([...ONB_PROVIDERS], [...PROVIDER_SLUGS]);
    assert.deepEqual(ONB_LICHESS_REASONS.filter((r) => r !== "access_denied" && r !== "unknown"), [...LICHESS_ERROR_REASONS]);
    assert.ok(DAILY_MINUTES.every((m) => onboardingClientEvents.onb_minutes_changed.safeParse({ minutes: m }).success));
  });

  it("names are unique across the registry and server events are not client ones", () => {
    const others = { ...shellEvents, ...systemEvents, ...gameEvents, ...reviewEvents, ...billingEvents };
    for (const name of Object.keys(onboardingEvents)) assert.ok(!(name in others), name);
    for (const name of Object.keys(onboardingServerEvents)) assert.ok(!(name in onboardingClientEvents), name);
  });
});
