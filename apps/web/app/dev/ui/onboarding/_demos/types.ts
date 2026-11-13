// The onboarding demo registry's entry shape (phase-04 plan §4.12): each step lists its design states and renders
// one on fixtures, with no network. `stress` = 20-character usernames, 80-character opening names, five-digit counts.
import type { OnbPage } from "@/lib/onboarding/steps";

export type DemoOptions = { stress: boolean };

export type OnboardingDemo = {
  page: OnbPage;
  /** The board's states first (state-coverage tags `@demo:<Board>.<state>`), then the undrawn ones. */
  states: readonly string[];
  /** The design board the states belong to (V3Onb…). */
  board: string;
  render: (state: string, opts: DemoOptions) => React.ReactNode;
};

export const STRESS_NAME = "KnightOwl_TheLongest";
export const STRESS_OPENING = "Sicilian Defense: Najdorf Variation, English Attack, Anti-English with 6...Ng4 7.Bg5";
