// The Goals step's "Your day" preview (phase-04 plan §4.5, §8.3; V3OnbGoals). Pure and client-safe; P5's daily plan
// may reuse the weights.
//
// For the timed goals G and the daily minutes M ∈ {5, 10, 20}: m_i = max(1, round(M · w_i / Σ_G w)) (the board's
// formula); then, while Σ m_i ≠ M, one minute is added to (or taken from) the row with the largest weight, never
// below 1 minute. If every row is at 1 and the sum still exceeds M, the sum stays (the header shows the true total).
// "Play friends" takes no minutes (OD-6, inv-pub §2.17): it shows "ANYTIME". If the owner prefers the board's 0.2,
// set GOAL_WEIGHTS.PLAY_FRIENDS = 0.2.
import { DAILY_MINUTES, type DailyMinutes, type OnboardingGoalDb } from "@repo/contracts/http/p04-plain";

/** Chip order (V3OnbGoals) and the tie-break order of equal weights. */
export const GOAL_ORDER = ["STOP_BLUNDERING", "LEARN_OPENINGS", "IMPROVE_ENDGAMES", "STUDY_LEGENDS", "PLAY_FRIENDS"] as const satisfies readonly OnboardingGoalDb[];

/** Minutes weight of each goal; null = untimed ("ANYTIME"). */
export const GOAL_WEIGHTS: Readonly<Record<OnboardingGoalDb, number | null>> = {
  STOP_BLUNDERING: 0.45,
  LEARN_OPENINGS: 0.25,
  IMPROVE_ENDGAMES: 0.25,
  STUDY_LEGENDS: 0.3,
  PLAY_FRIENDS: null,
};

export type GoalCopy = {
  /** The chip ("Stop blundering"). */
  label: string;
  /** The preview row ("Mistake Bank review · Positions from your own games"). */
  title: string;
  desc: string;
};

export const GOAL_COPY: Readonly<Record<OnboardingGoalDb, GoalCopy>> = {
  STOP_BLUNDERING: { label: "Stop blundering", title: "Mistake Bank review", desc: "Positions from your own games" },
  LEARN_OPENINGS: { label: "Learn openings", title: "Opening line", desc: "One line you actually play" },
  IMPROVE_ENDGAMES: { label: "Improve endgames", title: "Endgame drill", desc: "King and pawn technique" },
  STUDY_LEGENDS: { label: "Study legends", title: "Legend position", desc: "Play a famous moment" },
  PLAY_FRIENDS: { label: "Play friends", title: "Challenge a friend", desc: "Send a link from any position" },
};

/** The board's preselection when nothing is saved yet. */
export const DEFAULT_GOALS: readonly OnboardingGoalDb[] = ["STOP_BLUNDERING", "STUDY_LEGENDS"];
export const DEFAULT_MINUTES: DailyMinutes = 10;

/** What Skip saves, so Home has something to lead with (§4.5). */
export const SKIP_GOALS: readonly OnboardingGoalDb[] = ["STOP_BLUNDERING"];
export const SKIP_MINUTES: DailyMinutes = 10;

export type DayRow = {
  goal: OnboardingGoalDb;
  title: string;
  desc: string;
  /** null for an untimed goal. */
  minutes: number | null;
  /** "6 MIN" | "ANYTIME". */
  label: string;
};

export type DayPreview = {
  rows: DayRow[];
  /** M, or the true sum when the one-minute floor pushes it past M. */
  totalMinutes: number;
  /** "10 MIN A DAY". */
  totalLabel: string;
};

export function isDailyMinutes(value: unknown): value is DailyMinutes {
  return (DAILY_MINUTES as readonly unknown[]).includes(value);
}

/** The selection in chip order, without duplicates or unknown values. */
export function orderedGoals(goals: Iterable<OnboardingGoalDb>): OnboardingGoalDb[] {
  const set = new Set<string>(goals);
  return GOAL_ORDER.filter((g) => set.has(g));
}

/** Index of the row to adjust: the largest weight (first in chip order on ties) that may move in `direction`. */
function pick(weights: readonly number[], minutes: readonly number[], direction: 1 | -1): number {
  let best = -1;
  for (let i = 0; i < weights.length; i += 1) {
    if (direction === -1 && minutes[i]! <= 1) continue;
    if (best < 0 || weights[i]! > weights[best]!) best = i;
  }
  return best;
}

/** Minutes per timed goal for `total` daily minutes (§8.3). `weights` are the timed goals' weights, in order. */
export function splitMinutes(weights: readonly number[], total: number): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, w) => a + w, 0);
  const minutes = weights.map((w) => Math.max(1, Math.round((total * w) / sum)));
  // At most `total + weights.length` steps: each moves the sum one minute towards `total`, or stops.
  for (let guard = 0; guard <= total + weights.length; guard += 1) {
    const current = minutes.reduce((a, m) => a + m, 0);
    if (current === total) break;
    const direction = current < total ? 1 : -1;
    const i = pick(weights, minutes, direction);
    if (i < 0) break; // every row at 1 minute and still over: keep the true sum
    minutes[i] = minutes[i]! + direction;
  }
  return minutes;
}

/** The preview for a selection (§8.3). Rows follow the chip order; untimed goals show "ANYTIME". */
export function previewDay(goals: Iterable<OnboardingGoalDb>, dailyMinutes: DailyMinutes): DayPreview {
  const chosen = orderedGoals(goals);
  const timed = chosen.filter((g) => GOAL_WEIGHTS[g] !== null);
  const split = splitMinutes(
    timed.map((g) => GOAL_WEIGHTS[g]!),
    dailyMinutes,
  );
  const minutesOf = new Map(timed.map((g, i) => [g, split[i]!] as const));
  const rows: DayRow[] = chosen.map((goal) => {
    const minutes = minutesOf.get(goal) ?? null;
    const { title, desc } = GOAL_COPY[goal];
    return { goal, title, desc, minutes, label: minutes === null ? "ANYTIME" : `${minutes} MIN` };
  });
  const sum = split.reduce((a, m) => a + m, 0);
  const totalMinutes = Math.max(dailyMinutes, sum);
  return { rows, totalMinutes, totalLabel: `${totalMinutes} MIN A DAY` };
}

/** The Goals step's first selection: the saved goals and minutes, else the board's defaults. */
export function initialGoalsState(saved: { goals: readonly OnboardingGoalDb[]; dailyMinutes: number | null }): {
  goals: OnboardingGoalDb[];
  dailyMinutes: DailyMinutes;
} {
  return {
    goals: saved.goals.length > 0 ? orderedGoals(saved.goals) : [...DEFAULT_GOALS],
    dailyMinutes: isDailyMinutes(saved.dailyMinutes) ? saved.dailyMinutes : DEFAULT_MINUTES,
  };
}

/** `none_selected` when nothing is picked (Continue is disabled), else `default` (V3OnbGoals enum). */
export function goalsState(goals: readonly OnboardingGoalDb[]): "default" | "none_selected" {
  return goals.length === 0 ? "none_selected" : "default";
}
