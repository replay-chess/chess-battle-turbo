// The Train hub's screen model (phase-05 plan §4.2; DR/V3TrainHub*.dc.html and the device boards). Pure: every string
// the hub prints is generated here from `TrainToday` (never the design's sample numbers), so the route, the demo and
// the tests share it.
import type { PlanStep, TrainToday } from "@repo/contracts/http/train";

export type HubPlanModel = {
  heading: string;
  /** "0 of 2 done"; `complete` colours it as done. */
  progress: string;
  complete: boolean;
  /** The "nothing is due" line under the steps (nothingdue / cap reached), or null. */
  line: string | null;
};

/** A step's tag: Due now (warn), Step n (neutral), Done (good, with a tick). */
export type StepTag = { text: string; tone: "warn" | "neutral" | "good" };

export function stepTag(step: Pick<PlanStep, "status">, index: number): StepTag {
  if (step.status === "done") return { text: "Done", tone: "good" };
  if (step.status === "due") return { text: "Due now", tone: "warn" };
  return { text: `Step ${index + 1}`, tone: "neutral" };
}

const TAG_SPOKEN: Record<PlanStep["status"], string> = { due: "due now", next: "up next", done: "done" };

/** "Step 1 of 2, due now: Review 3 mistakes from yesterday's game, Mistake Bank, vs tal_fan_77, about 2 minutes". */
export function stepAccessibleName(step: PlanStep, index: number, total: number): string {
  const sub = step.subtitle
    .split(" · ")
    .map((part) => part.replace(/^~(\d+) min$/, (_m, n: string) => `about ${n} ${n === "1" ? "minute" : "minutes"}`))
    .join(", ");
  return `Step ${index + 1} of ${total}, ${TAG_SPOKEN[step.status]}: ${step.title}, ${sub}`;
}

/** "Thursday · 6 minutes planned". */
export function eyebrowOf(t: Pick<TrainToday, "weekdayLabel" | "plannedMinutes">): string {
  const m = t.plannedMinutes;
  return `${t.weekdayLabel} · ${m} ${m === 1 ? "minute" : "minutes"} planned`;
}

/** The next batch's sentence: "Nothing is due. Your next 6 reviews arrive tomorrow at 08:00." */
export function nothingDueLine(t: Pick<TrainToday, "nextBatch">, day: string | null): string {
  const nb = t.nextBatch;
  if (!nb || nb.count === 0) return "Nothing is due.";
  const when = `${day ? `${day} ` : ""}at ${nb.atLabel}`;
  return `Nothing is due. Your next ${nb.count} ${nb.count === 1 ? "review arrives" : "reviews arrive"} ${when}.`;
}

/** The phone's short form: "Next 6 reviews arrive tomorrow at 08:00." (V3iPhoneTrainHub nothingdue). */
export function nextBatchShort(t: Pick<TrainToday, "nextBatch">, day: string | null): string | null {
  const nb = t.nextBatch;
  if (!nb || nb.count === 0) return null;
  return `Next ${nb.count} ${nb.count === 1 ? "review arrives" : "reviews arrive"} ${day ? `${day} ` : ""}at ${nb.atLabel}.`;
}

export function planModel(t: TrainToday, day: string | null): HubPlanModel {
  const { done, total } = t.plan;
  const complete = total > 0 && done >= total;
  const nothingDue = t.state === "nothingdue";
  return {
    heading: complete ? "Done for today" : "Today’s plan",
    progress: `${done} of ${total} done`,
    complete,
    // Cap reached with due cards left: the server's waiting line ("You reviewed today's 10 positions. 6 more wait
    // for tomorrow."); otherwise the next batch.
    line: nothingDue ? (t.due.waitingLine ?? nothingDueLine(t, day)) : null,
  };
}

export type HubCta =
  | { kind: "start"; label: string; variant: "primary" }
  | { kind: "link"; label: string; href: string; variant: "secondary" }
  | { kind: "none" };

/**
 * Start / Continue → the daily session (POST, then the runner; the id is server-made, so not a link). Keep Going → a
 * plain link to the focus theme's puzzles. A plan whose steps are all done and has no keep-going target shows none.
 */
export function ctaOf(t: TrainToday): HubCta {
  const cta = t.plan.cta;
  if (cta.kind === "keep_going") {
    const href = cta.href ?? t.keepGoing?.href ?? null;
    return href ? { kind: "link", label: cta.label, href, variant: "secondary" } : { kind: "none" };
  }
  if (t.plan.steps.length === 0 || t.plan.done >= t.plan.total) return { kind: "none" };
  return { kind: "start", label: cta.label, variant: "primary" };
}

/** "4 due · 23 positions from your games". */
export function bankRowSub(t: Pick<TrainToday, "allTraining">): string {
  const { due, total } = t.allTraining.bank;
  if (total === 0) return "Mistakes from your games land here";
  return `${due} due · ${total} ${total === 1 ? "position" : "positions"} from your games`;
}

/** "Forks 62% · Pins 18% · Back rank 40%" ("New" under 5 attempts); a member with no attempts gets the invitation. */
export function puzzlesRowSub(t: Pick<TrainToday, "allTraining">): string {
  const themes = t.allTraining.puzzles.themes;
  if (!themes.length) return "Pick a theme and start";
  return themes.map((th) => `${th.label} ${th.pct === null ? "New" : `${th.pct}%`}`).join(" · ");
}

/** The streak block's two lines. */
export function streakLines(t: Pick<TrainToday, "streak">): { title: string; sub: string } {
  const { current, best } = t.streak;
  return {
    title: current > 0 ? `${current}-day streak` : "No streak yet",
    sub: best > 0 ? `Best ${best} · resets if you skip 2 days` : "Train today to start one",
  };
}

/** The phone chip: "4-day streak" and "6 min today". */
export function phoneStreakChip(t: Pick<TrainToday, "streak" | "plannedMinutes">): { title: string; minutes: string } {
  return { title: streakLines(t).title, minutes: `${t.plannedMinutes} min today` };
}

export const WEEK_LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;

/** The due strip: 3 thumbnails on desktop, 4 on iPad landscape (the 4th hides by CSS), the empty card for a new bank. */
export function dueStripModel(t: Pick<TrainToday, "due" | "allTraining">): "thumbs" | "empty_bank" | "nothing_due" {
  if (t.due.preview.length > 0) return "thumbs";
  return t.allTraining.bank.total === 0 ? "empty_bank" : "nothing_due";
}

/** `train_hub_viewed.state`: the new-user plan counts as its own state. */
export function viewedState(t: Pick<TrainToday, "state" | "plan">): "default" | "nothingdue" | "new_user" {
  if (t.plan.basis === "new") return "new_user";
  return t.state;
}

/** The step's analytics target (`train_hub_link_clicked`), step 3 (P8's lesson) is not a P5 target. */
export function stepTarget(index: number): "step_1" | "step_2" | null {
  return index === 0 ? "step_1" : index === 1 ? "step_2" : null;
}

/** The plan's session-creating step URLs are never prefetched (§5.1): every step href renders a creating page. */
export function isSessionCreatingHref(href: string): boolean {
  return href.startsWith("/train/bank/session") || href.startsWith("/train/puzzles");
}

/** The ms until the release timer should fire (≤ 24 h), or null when there is nothing to wait for. */
export function releaseDelayMs(nextAt: string | null, nowMs: number): number | null {
  const at = nextAt ? Date.parse(nextAt) : NaN;
  if (!Number.isFinite(at)) return null;
  const delay = at - nowMs;
  if (delay <= 0 || delay > 86_400_000) return null;
  return delay;
}
