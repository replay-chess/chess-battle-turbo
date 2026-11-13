// The onboarding demo states (app/dev/ui/onboarding/_demos, phase-04 plan §4.12) for the P4 device, a11y and visual
// specs: per step, its design board and, per demo state, the board-state values it shows (`[]` = a state the boards
// do not draw). Pure data.
export type OnbDemoStep = "welcome" | "link" | "confirm" | "level" | "goals" | "plan" | "activating" | "done";

/** The demo states per step (app/dev/ui/onboarding/_demos), the board each belongs to, and its board-state values. */
export const ONBOARDING_DEMO_STATES: Record<OnbDemoStep, { board: string; states: Record<string, string[]> }> = {
  welcome: { board: "OnbWelcome", states: { default: ["default"], trial_used: [], already_linked: [], trialing: [] } },
  link: {
    board: "OnbLink",
    states: {
      default: ["default"],
      validating: ["validating"],
      found: ["found"],
      not_found: ["not_found"],
      private_profile: ["private_profile"],
      rate_limited: ["rate_limited"],
      lichess_denied: ["lichess_denied"],
      found_no_games: [],
      invalid: [],
      linked_elsewhere: [],
      upstream: [],
      lichess_error: [],
    },
  },
  confirm: {
    board: "OnbPreview",
    states: { default: ["default"], loading: ["loading"], no_games: ["no_games"], recent_failed: [], unavailable: [], private: [], lichess: [] },
  },
  level: { board: "OnbRating", states: { prefilled: ["prefilled"], manual: ["manual"], new_to_chess: [], lichess: [] } },
  goals: { board: "OnbGoals", states: { default: ["default"], none_selected: ["none_selected"], all_goals_5_min: [], only_friends: [] } },
  plan: {
    board: "OnbPlan",
    states: {
      default: ["default", "monthly"],
      loading: ["loading", "monthly"],
      yearly: ["default", "yearly"],
      trial_used: [],
      failed: [],
      abandoned: [],
      start_error: [],
      not_configured: [],
    },
  },
  activating: {
    board: "OnbActivating",
    states: { polling: ["polling"], stalled: ["stalled"], success: ["success"], paid_polling: [], paid_success: [], failed: [] },
  },
  done: {
    board: "OnbDone",
    states: {
      importing: ["importing"],
      import_failed: ["import_failed"],
      imported: ["imported"],
      importing_reading: [],
      nothing_linked: [],
      zero_games: [],
      trial_starting: [],
      paid_member: [],
      no_legend: [],
    },
  },
};

