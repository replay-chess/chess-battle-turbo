// Demo data for the P5 dev routes (phase-05 plan §2.1 "Dev demo routes", §4; SPEC D11): `/dev/ui/train/{hub,bank,
// runner,puzzles,summary}?state=` and `/dev/ui/home?state=`, each with `&stress=1` for the longest content. Every value
// is a contract-valid fixture from `@repo/contracts/http/fixtures/p05` (the design's data), arranged by the board state
// enums of `docs/qa/design-states.json`, plus the undesigned states §4 specifies (cap reached, partial plan, new-user
// hub, saving, broken item, review position). Pure data: no zod, no server imports, safe in client demos.
// train.test.ts parses every state with its schema and replays every line with chess.js.
//
// Runner states are a payload plus a `script`: the user actions that reach the board state from the first item
// (`hint`, a `move` in UCI, `solution`, `themes`), so the demo drives the real TrainerRunner instead of faking it.
import type { BankPage, SessionPayload, SessionSummary, TrainItem, TrainToday } from "@repo/contracts/http/train";
import type { HomeData } from "@repo/contracts/http/home";
import {
  bankPageFixture,
  homeFixture,
  P5_FIXTURE_NOW,
  sessionPayloadFixture,
  sessionSummaryFixture,
  trainTodayFixture,
} from "@repo/contracts/http/fixtures/p05";

export { P5_FIXTURE_NOW };

/** `?stress=1` on any P5 demo route. */
export function isStress(search: { stress?: string | string[] | undefined }): boolean {
  const v = Array.isArray(search.stress) ? search.stress[0] : search.stress;
  return v === "1";
}

/** The `?state=` value if it is one of `states`, else the first state (fail-closed to the default board). */
export function pickState<S extends string>(states: readonly S[], raw: string | string[] | undefined): S {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (states as readonly string[]).includes(v ?? "") ? (v as S) : states[0]!;
}

// ── Hub (V3TrainHub, V3TrainHubDone, V3TrainHubLoading + device boards; enum default | nothingdue | loading) ─────────
export const HUB_DEMO_STATES = ["default", "nothingdue", "loading", "cap_reached", "partial", "new_user"] as const;
export type HubDemoState = (typeof HUB_DEMO_STATES)[number];

/** `null` = the loading skeleton (loading.tsx / the in-place plan skeleton). */
export function hubDemo(state: HubDemoState, stress = false): TrainToday | null {
  if (state === "loading") return null;
  if (stress) return trainTodayFixture("stress");
  return trainTodayFixture(state);
}

// ── Bank (V3MistakeBank default | filtered | loading; V3BankEmpty/CaughtUp/Loading; device due | empty | caughtup) ──
export const BANK_DEMO_STATES = ["default", "filtered", "loading", "empty", "caughtup", "cap_reached", "due"] as const;
export type BankDemoState = (typeof BANK_DEMO_STATES)[number];

export type BankDemo = {
  page: BankPage;
  /** The client filter the page opens with (`filtered`: Theme = Fork, as the design's popover shows). */
  filter: { view?: "due" | "all"; theme?: string; phase?: "opening" | "middlegame" | "endgame"; source?: "own" | "missed" };
  complete: boolean;
} | null;

export function bankDemo(state: BankDemoState, stress = false): BankDemo {
  if (state === "loading") return null;
  if (stress) return { page: bankPageFixture("stress"), filter: {}, complete: true };
  switch (state) {
    case "default":
      return { page: bankPageFixture("default"), filter: { view: "all" }, complete: true };
    case "due":
      return { page: bankPageFixture("default"), filter: { view: "due" }, complete: true };
    case "filtered":
      return { page: bankPageFixture("default"), filter: { view: "all", theme: "fork" }, complete: true };
    case "empty":
      return { page: bankPageFixture("empty"), filter: {}, complete: true };
    case "caughtup":
      return { page: bankPageFixture("caughtup"), filter: {}, complete: true };
    case "cap_reached":
      return { page: bankPageFixture("cap_reached"), filter: {}, complete: true };
  }
}

// ── Runner (V3BankSession and V3Puzzle*: solve | hint | wrong | correct | solution | themes) ─────────────────────
export const RUNNER_DEMO_STATES = [
  "solve",
  "hint",
  "hint_arrow",
  "wrong",
  "correct",
  "solution",
  "themes",
  "done",
  "saving",
  "broken",
  "review_position",
  "resumed",
  "caughtup",
  "cap_reached",
  "nothing_matches",
] as const;
export type RunnerDemoState = (typeof RUNNER_DEMO_STATES)[number];

/** Puzzle mode has no review positions and no bank cap: those runner states are bank-only. */
export const PUZZLE_DEMO_STATES = ["solve", "hint", "hint_arrow", "wrong", "correct", "solution", "themes", "done", "saving", "broken", "resumed"] as const;
export type PuzzleDemoState = (typeof PUZZLE_DEMO_STATES)[number];

export type DemoStep = { type: "hint" } | { type: "move"; uci: string } | { type: "solution" } | { type: "themes" } | { type: "grade"; grade: "again" | "hard" | "good" | "easy" };

export type RunnerDemo = {
  payload: SessionPayload;
  /** The user's actions from the first item (opponent replies and the setup move are auto-played by the runner). */
  script: DemoStep[];
  /** `saving`: the outbox holds this many graded items when the session ends. */
  pendingOutbox?: number;
};

/** The user's moves of an item's solution (every other ply, starting with the first). */
export function userMoves(item: TrainItem): string[] {
  return item.solution.filter((_, i) => i % 2 === 0);
}

/** A bank item whose stored line fails chess.js validation (the "broken item" path: skipped + auto-report). */
function brokenItem(item: TrainItem): TrainItem {
  return { ...item, itemId: "ibroken", solution: ["a1a8"], accept: [] };
}

/** A review position (isPuzzle false): one move, any of `accept ∪ {best}` solves ("Good enough. The engine's best was …"). */
function reviewPositionItem(item: TrainItem): TrainItem {
  return { ...item, kind: "review_position", solution: [item.solution[0]!], accept: ["d1d2", "d1e1"] };
}

function runnerFor(mode: "bank" | "puzzles", state: RunnerDemoState, stress: boolean): RunnerDemo {
  const base = stress ? sessionPayloadFixture(mode === "bank" ? "stress_bank" : "stress_puzzles") : sessionPayloadFixture(mode);
  const first = base.items[0]!;
  const wrong = mode === "bank" ? first.context!.playedUci : "b5d6";
  switch (state) {
    case "solve":
      return { payload: base, script: [] };
    case "hint":
      return { payload: base, script: [{ type: "hint" }] };
    case "hint_arrow":
      return { payload: base, script: [{ type: "hint" }, { type: "hint" }] };
    case "wrong":
      return { payload: base, script: [{ type: "move", uci: wrong }] };
    case "correct":
      return { payload: base, script: userMoves(first).map((uci) => ({ type: "move", uci }) as const) };
    case "solution":
      return { payload: base, script: [{ type: "solution" }] };
    case "themes":
      return { payload: mode === "bank" ? { ...base, themes: sessionPayloadFixture("puzzles").themes } : base, script: [{ type: "themes" }] };
    case "done":
    case "saving": {
      const script: DemoStep[] = base.items.flatMap((it) => [...userMoves(it).map((uci) => ({ type: "move", uci }) as const), { type: "grade", grade: "good" } as const]);
      return { payload: base, script, ...(state === "saving" ? { pendingOutbox: base.items.length } : {}) };
    }
    case "broken":
      return { payload: { ...base, items: [brokenItem(first), ...base.items] }, script: [] };
    case "review_position":
      return { payload: { ...base, items: [reviewPositionItem(first), ...base.items.slice(1)] }, script: [{ type: "move", uci: "d1d2" }] };
    case "resumed":
      return { payload: mode === "bank" ? sessionPayloadFixture("resumed") : { ...base, resumeIndex: 2 }, script: [] };
    case "caughtup":
    case "cap_reached":
    case "nothing_matches":
      return { payload: sessionPayloadFixture(state), script: [] };
  }
}

/** `/dev/ui/train/runner?state=` (bank mode, V3BankSession). */
export function runnerDemo(state: RunnerDemoState, stress = false): RunnerDemo {
  return runnerFor("bank", state, stress);
}

/** `/dev/ui/train/puzzles?state=` (theme mode, V3Puzzle*: the payload starts with the setup move). */
export function puzzlesDemo(state: PuzzleDemoState, stress = false): RunnerDemo {
  return runnerFor("puzzles", state, stress);
}

// ── Summary (V3SessionSummary default, V3SessionPerfect perfect) ──────────────────────────────────────────────────
export const SUMMARY_DEMO_STATES = ["default", "perfect", "puzzles", "saving"] as const;
export type SummaryDemoState = (typeof SUMMARY_DEMO_STATES)[number];

export type SummaryDemo = {
  summary: SessionSummary;
  /** `?n=` the client navigated with (graded on the device); > summary.graded means "Saving…". */
  clientGraded: number;
};

export function summaryDemo(state: SummaryDemoState, stress = false): SummaryDemo {
  if (stress) return { summary: sessionSummaryFixture("stress"), clientGraded: 40 };
  const summary = sessionSummaryFixture(state);
  return { summary, clientGraded: state === "saving" ? 6 : summary.graded };
}

// ── Home (V3Home populated | new_user | loading | import_running | payment_failed | trial) ──────────────────────────
export const HOME_DEMO_STATES = ["populated", "new_user", "loading", "import_running", "payment_failed", "trial", "analysing", "clean", "nothing_due"] as const;
export type HomeDemoState = (typeof HOME_DEMO_STATES)[number];

export type HomeDemo = {
  data: HomeData;
  /** The shell states the page does not draw itself (P1's payment banner and the trial nav tag). */
  shell: { paymentFailed: boolean; trialDaysLeft: number | null };
} | null;

export function homeDemo(state: HomeDemoState, stress = false): HomeDemo {
  if (state === "loading") return null;
  // Stress keeps the requested state (FIX-1: `new_user&stress=1` rendered the populated stress page, which has no
  // Play Your First Legend Position): the new-user page gets the stress greeting and the longest blurb, every other
  // state the populated stress data.
  if (stress && state === "new_user") {
    const base = homeFixture("new_user");
    const long = homeFixture("stress");
    return {
      data: { ...base, greeting: long.greeting, startHere: base.startHere ? { ...base.startHere, blurb: `${base.startHere.blurb} `.repeat(4).slice(0, 300).trim() } : null },
      shell: { paymentFailed: false, trialDaysLeft: null },
    };
  }
  if (stress) return { data: homeFixture("stress"), shell: { paymentFailed: false, trialDaysLeft: null } };
  switch (state) {
    case "payment_failed":
      return { data: homeFixture("populated"), shell: { paymentFailed: true, trialDaysLeft: null } };
    case "trial":
      return { data: homeFixture("populated"), shell: { paymentFailed: false, trialDaysLeft: 5 } };
    default:
      return { data: homeFixture(state), shell: { paymentFailed: false, trialDaysLeft: null } };
  }
}
