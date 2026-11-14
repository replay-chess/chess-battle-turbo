// The daily plan (phase-05 plan §8.10, §4.2): built once on the first hub read of a training day and frozen in
// `training_days.plan` (`DailyPlanV1`, `@repo/db/json`), so it never reshuffles during the day. Pure: the service
// passes the rows; nothing here reads the clock or the database. Browser-safe, but only the server builds plans.
import type { PlanStepKind } from "@repo/contracts/http/train";
import { DEFAULT_FOCUS_THEME, IMPORT_HREF, PLAN_BANK_HREF, PLAN_PUZZLE_COUNT } from "./constants";
import { estimateMinutes, minutesLabel, monthDayLabel, playedAtLabel, plural } from "./labels";
import { themeBit, themeInfo, themeNoun } from "./themes";
import { localDate } from "./tz";

export type PlanBasis = "bank" | "games20" | "new";
/** The step kinds (`@repo/contracts/http/train` `PlanStepKind`, the one source). */
export type { PlanStepKind };

/** One frozen step (`DailyPlanV1.steps[i]`). */
export interface DailyPlanStep {
  kind: PlanStepKind;
  /** Bank step: the frozen card keys (≤ 10). */
  cardKeys?: string[];
  theme?: string;
  count?: number;
  title: string;
  subtitle: string;
  estMin: number;
  href: string;
}

/** The shape of `DailyPlanV1` (`@repo/db/json` validates it before the write). */
export interface DailyPlan {
  v: 1;
  createdAt: string;
  basis: PlanBasis;
  focusTheme: string;
  steps: DailyPlanStep[];
}

/** A due BANK card for the plan, in the §8.6 queue order (`session.ts orderDueQueue`). */
export interface PlanBankCard {
  key: string;
  /** The game it last happened in (`mistakes."lastGameId"`, as a ref or id: only equality matters). */
  game: string;
  playedAt: Date;
  opponent: string;
}

export interface PlanTheme {
  key: string;
  attempts: number;
  ewma: number;
  bankCount: number;
}

/** Why the focus theme was picked (the puzzle step's subtitle says it). */
export type FocusSource = "weakness" | "lowestMastery" | "bankCount" | "default";

export interface PlanInputs {
  now: Date;
  timeZone: string;
  /** `capState(...).dueShown`: how many bank cards the plan may freeze. */
  dueShown: number;
  /** Due BANK cards in queue order (≤ 50 rows are read). */
  bankQueue: readonly PlanBankCard[];
  /** Live BANK cards (any due date). */
  bankTotal: number;
  /** The newest analysed game, for the empty-bank step. */
  lastGame: { ref: string; opponent: string; reviewed: boolean; moments: number } | null;
  /** theme_mastery rows. */
  themes: readonly PlanTheme[];
  /** P6: the top weakness mapped to a Lichess theme. Null in P5. */
  weaknessTheme?: string | null;
  puzzleRating: number;
  /** P6 switches the basis to "games20"; P5 plans from the bank. */
  basis?: PlanBasis;
}

const BANK_STEP_MAX = 10;

/** A theme the shards serve (a puzzle step can only train those). */
function isPuzzleTheme(key: string): boolean {
  const kind = themeInfo(key).kind;
  return themeBit(key) !== null && kind !== "meta" && kind !== "phase";
}

/**
 * The focus theme (§8.10 step 2): P6's weakness → the lowest EWMA among themes with ≥ 5 attempts → the theme with the
 * most BANK cards → `fork`. Only themes the shards serve qualify.
 */
export function focusTheme(themes: readonly PlanTheme[], weaknessTheme?: string | null): { key: string; source: FocusSource } {
  if (weaknessTheme && isPuzzleTheme(weaknessTheme)) return { key: weaknessTheme, source: "weakness" };
  const byKey = (a: PlanTheme, b: PlanTheme) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const rated = themes.filter((t) => t.attempts >= 5 && isPuzzleTheme(t.key)).sort((a, b) => a.ewma - b.ewma || byKey(a, b));
  if (rated[0]) return { key: rated[0].key, source: "lowestMastery" };
  const banked = themes.filter((t) => t.bankCount > 0 && isPuzzleTheme(t.key)).sort((a, b) => b.bankCount - a.bankCount || byKey(a, b));
  if (banked[0]) return { key: banked[0].key, source: "bankCount" };
  return { key: DEFAULT_FOCUS_THEME, source: "default" };
}

const FOCUS_REASON: Record<FocusSource, string> = {
  weakness: "Your weakest theme",
  lowestMastery: "Your lowest-mastery theme",
  bankCount: "Most common in your bank",
  default: "Start here",
};

/** "today's game", "yesterday's game", "your Oct 27 game". */
function gameWhen(playedAt: Date, now: Date, timeZone: string): string {
  const when = playedAtLabel(playedAt, now, timeZone);
  if (when === "today" || when === "yesterday") return `${when}'s game`;
  return `your ${monthDayLabel(localDate(playedAt, timeZone))} game`;
}

function bankStep(cards: readonly PlanBankCard[], now: Date, timeZone: string): DailyPlanStep {
  const n = cards.length;
  const estMin = estimateMinutes({ bank: n });
  const games = new Set(cards.map((c) => c.game));
  const first = cards[0]!;
  if (games.size === 1) {
    return {
      kind: "bank",
      cardKeys: cards.map((c) => c.key),
      title: `Review ${plural(n, "mistake")} from ${gameWhen(first.playedAt, now, timeZone)}`,
      subtitle: `Mistake Bank · vs ${first.opponent} · ${minutesLabel(estMin)}`,
      estMin,
      href: PLAN_BANK_HREF,
    };
  }
  return {
    kind: "bank",
    cardKeys: cards.map((c) => c.key),
    title: `Review ${n} due ${n === 1 ? "mistake" : "mistakes"}`,
    subtitle: `Mistake Bank · ${games.size} games · ${minutesLabel(estMin)}`,
    estMin,
    href: PLAN_BANK_HREF,
  };
}

function emptyBankStep(lastGame: PlanInputs["lastGame"]): DailyPlanStep {
  if (lastGame && !lastGame.reviewed) {
    const found = lastGame.moments > 0 ? `the coach found ${plural(lastGame.moments, "moment")}` : "a clean game";
    return {
      kind: "review",
      title: "Review your last game",
      subtitle: `vs ${lastGame.opponent} · ${found} · ${minutesLabel(1)}`,
      estMin: 1,
      href: `/review/${lastGame.ref}`,
    };
  }
  return {
    kind: "import",
    title: "Import games",
    subtitle: `Connect Chess.com or Lichess · ${minutesLabel(1)}`,
    estMin: 1,
    href: IMPORT_HREF,
  };
}

function puzzleStep(theme: string, source: FocusSource, rating: number): DailyPlanStep {
  const estMin = estimateMinutes({ puzzles: PLAN_PUZZLE_COUNT });
  return {
    kind: "puzzles",
    theme,
    count: PLAN_PUZZLE_COUNT,
    title: `${PLAN_PUZZLE_COUNT} ${themeNoun(theme)} puzzles at your level`,
    subtitle: `${FOCUS_REASON[source]} · rating ${Math.round(rating)} · ${minutesLabel(estMin)}`,
    estMin,
    href: puzzlesHref(theme, { n: PLAN_PUZZLE_COUNT, source: "plan" }),
  };
}

/** `/train/puzzles?theme=fork&n=3&source=plan`. */
export function puzzlesHref(theme: string, o: { n?: number; source: string }): string {
  const q = new URLSearchParams({ theme });
  if (o.n !== undefined) q.set("n", String(o.n));
  q.set("source", o.source);
  return `/train/puzzles?${q.toString()}`;
}

/**
 * Today's plan (§8.10): (1) up to `dueShown` (≤ 10) bank cards from the queue, keys frozen — or, with an empty bank,
 * "Review your last game" / "Import games"; (2) 3 puzzles on the focus theme; (3) the lesson step is P8's (omitted).
 * A bank with cards but nothing due gets no bank step.
 */
export function buildDailyPlan(i: PlanInputs): DailyPlan {
  const steps: DailyPlanStep[] = [];
  const n = Math.min(i.dueShown, i.bankQueue.length, BANK_STEP_MAX);
  if (n > 0) steps.push(bankStep(i.bankQueue.slice(0, n), i.now, i.timeZone));
  else if (i.bankTotal === 0) steps.push(emptyBankStep(i.lastGame));
  const focus = focusTheme(i.themes, i.weaknessTheme);
  steps.push(puzzleStep(focus.key, focus.source, i.puzzleRating));
  return {
    v: 1,
    createdAt: i.now.toISOString(),
    basis: i.basis ?? (i.bankTotal > 0 ? "bank" : "new"),
    focusTheme: focus.key,
    steps,
  };
}

// ── Reading a frozen plan ──────────────────────────────────────────────────────────────────────────────────────

export type PlanStepStatus = "due" | "next" | "done";

/** Bit i of `planDone` = step i done. */
export function isStepDone(planDone: number, i: number): boolean {
  return ((planDone >>> i) & 1) === 1;
}

/** Number of done steps (popcount over the plan's steps). */
export function planDoneCount(planDone: number, steps: number): number {
  let n = 0;
  for (let i = 0; i < steps; i++) if (isStepDone(planDone, i)) n += 1;
  return n;
}

/** Step tags: the first open step is "due" (Due now), later open steps "next" (Step 2), the rest "done". */
export function planStepStatuses(steps: number, planDone: number): PlanStepStatus[] {
  let dueGiven = false;
  return Array.from({ length: steps }, (_, i) => {
    if (isStepDone(planDone, i)) return "done";
    if (!dueGiven) {
      dueGiven = true;
      return "due";
    }
    return "next";
  });
}

/** Σ estMin of the steps (the header's "6 minutes planned"); `openOnly` sums the steps not done yet. */
export function planMinutes(plan: Pick<DailyPlan, "steps">, planDone = 0, openOnly = false): number {
  return plan.steps.reduce((sum, s, i) => sum + (openOnly && isStepDone(planDone, i) ? 0 : s.estMin), 0);
}

/** "Thursday · 6 minutes planned". */
export function planHeader(weekday: string, minutes: number): string {
  return `${weekday} · ${plural(minutes, "minute")} planned`;
}

const titleCase = (s: string) => s.replace(/(^|\s)(\S)/g, (_, sp: string, c: string) => sp + c.toUpperCase());

/** "Keep Going: Fork Puzzles" (the caught-up CTA on the focus theme). */
export function keepGoingLabel(theme: string): string {
  return `Keep Going: ${titleCase(themeNoun(theme))} Puzzles`;
}

/** The plan CTA: start, continue (remaining minutes) or keep going once every step is done. */
export function planCta(plan: Pick<DailyPlan, "steps" | "focusTheme">, planDone: number): { kind: "start" | "continue" | "keep_going"; label: string } {
  const done = planDoneCount(planDone, plan.steps.length);
  if (done >= plan.steps.length) return { kind: "keep_going", label: keepGoingLabel(plan.focusTheme) };
  if (done === 0) return { kind: "start", label: `Start Today's Plan · ${minutesLabel(planMinutes(plan))}` };
  return { kind: "continue", label: `Continue Today's Plan · ${minutesLabel(planMinutes(plan, planDone, true))}` };
}

/** "Built from your Mistake Bank. Daily cap: 10 reviews." (P6: "Built from your last 20 games."). */
export function planFootnote(basis: PlanBasis, cap: number): string {
  const from = basis === "games20" ? "your last 20 games" : "your Mistake Bank";
  return `Built from ${from}. Daily cap: ${plural(cap, "review")}.`;
}

/** What happened today, for the step-completion rules. */
export interface PlanProgress {
  /** Card keys with a graded attempt today. */
  gradedKeys: ReadonlySet<string>;
  /** Graded PUZZLE attempts today, per theme. */
  puzzlesByTheme: ReadonlyMap<string, number>;
  /** The review step's game has been reviewed. */
  reviewDone?: boolean;
  /** An import is connected (the import step). */
  importDone?: boolean;
}

/**
 * The `planDone` bits the progress earns (§8.10): the bank step when every frozen key has a graded attempt today, the
 * puzzle step when at least `count` graded PUZZLE attempts today are on its theme. Only the frozen plan is read, so
 * later due changes never move a step.
 */
export function planDoneBits(plan: Pick<DailyPlan, "steps">, p: PlanProgress): number {
  let bits = 0;
  plan.steps.forEach((s, i) => {
    let done = false;
    if (s.kind === "bank") done = (s.cardKeys ?? []).length > 0 && (s.cardKeys ?? []).every((k) => p.gradedKeys.has(k));
    else if (s.kind === "puzzles") done = (p.puzzlesByTheme.get(s.theme ?? "") ?? 0) >= (s.count ?? PLAN_PUZZLE_COUNT);
    else if (s.kind === "review") done = p.reviewDone === true;
    else if (s.kind === "import") done = p.importDone === true;
    if (done) bits |= 1 << i;
  });
  return bits;
}
