// How we grade (phase-03 plan §4.5, §5.6; P3-Q11). Every number on the page comes from the constants the worker
// grades with (@repo/chess-analysis), so the page cannot drift from the grader; content.test.ts pins the wording to
// those constants. Server-only use: the page is force-static and ships none of this to the browser.
import { ACC_A, ACC_B, ACC_BONUS, ACC_C, WINDOW_MAX, WINDOW_MIN } from "@repo/chess-analysis/accuracy";
import { BRILLIANT_RULE, EXCELLENT_MAX_LOSS, GREAT_RULE, SEVERITY } from "@repo/chess-analysis/classify";
import { JUDGEMENT_KEYS, type JudgementKey } from "@repo/chess-analysis/codec";
import { ENGINE_PROFILE, GRADING_CHANGED_AT, GRADING_VERSION } from "@repo/chess-analysis/version";
import { WIN_CP_CLAMP, WIN_K } from "@repo/chess-analysis/winpct";
import { JOB_MAX_ATTEMPTS } from "@repo/contracts/internal/jobs";

export const HWG_TABS = ["labels", "acc"] as const;
export type HwgTab = (typeof HWG_TABS)[number];

export const TAB_LABEL: Record<HwgTab, string> = { labels: "Move Labels", acc: "Accuracy" };

/** Hash anchors and the tab that holds them (`#blunder` → Move Labels, `#failures` → Accuracy). */
export const FAILURES_ANCHOR = "failures";

export function tabOfAnchor(anchor: string): HwgTab | null {
  if ((JUDGEMENT_KEYS as readonly string[]).includes(anchor)) return "labels";
  if (anchor === FAILURES_ANCHOR || anchor === "accuracy" || anchor === "win-percent") return "acc";
  return null;
}

const num = (n: number) => n.toLocaleString("en-US");
const pawns = (cp: number) => `${num(cp / 100)} pawns`;

export type LabelRow = { key: JudgementKey; name: string; text: string };

const NAME: Record<JudgementKey, string> = {
  brilliant: "Brilliant",
  great: "Great",
  best: "Best",
  excellent: "Excellent",
  good: "Good",
  book: "Book",
  forced: "Forced",
  interesting: "Interesting",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  miss: "Miss",
  blunder: "Blunder",
};

/** The 12 rows, in JudgementCode order (the design's `mq` order), with the grader's thresholds. */
export function labelRows(): LabelRow[] {
  const text: Record<JudgementKey, string> = {
    brilliant: `A sound sacrifice that loses at most ${BRILLIANT_RULE.MAX_LOSS} win% points. Never given when you are already more than ${pawns(BRILLIANT_RULE.MAX_CP_BEFORE)} up, unless it forces mate.`,
    great: `The only move that keeps the result: the win, the draw or the hold. The next best move is at least ${GREAT_RULE.MIN_GAP} win% points worse.`,
    best: "The engine’s top choice.",
    excellent: `Almost as good as best: loses at most ${EXCELLENT_MAX_LOSS} win% points.`,
    good: `A solid move with a small loss, more than ${EXCELLENT_MAX_LOSS} and under ${SEVERITY.INACCURACY} win% points.`,
    book: `Known opening theory, from the ECO table, in the first ${ENGINE_PROFILE.bookMaxPly / 2} moves. Never generated.`,
    forced: "The only legal move.",
    interesting: "Not given yet: we need a model of human play to grade it fairly.",
    inaccuracy: `Loses ${SEVERITY.INACCURACY} to ${SEVERITY.MISTAKE} win% points.`,
    mistake: `Loses ${SEVERITY.MISTAKE} to ${SEVERITY.BLUNDER} win% points.`,
    miss: "Missed a win, or a tactic the opponent’s last move allowed.",
    blunder: `Loses ${SEVERITY.BLUNDER} or more win% points, or the game.`,
  };
  return JUDGEMENT_KEYS.map((key) => ({ key, name: NAME[key], text: text[key] }));
}

/** The constants as printed (4 significant decimals, as the formula card shows them). */
export const FORMULA = {
  a: ACC_A.toFixed(4),
  b: ACC_B.toFixed(5),
  c: ACC_C.toFixed(4),
  bonus: String(ACC_BONUS),
  k: String(WIN_K),
  clamp: num(WIN_CP_CLAMP),
} as const;

/** "move accuracy = 103.1668 × e^(−0.04354 × win% loss) − 3.1669 + 1" (with Lichess's +1, RES §3.1). */
export function accuracyFormula(): string {
  return `move accuracy = ${FORMULA.a} × e^(−${FORMULA.b} × win% loss) − ${FORMULA.c} + ${FORMULA.bonus}`;
}

/** The same formula in words, for screen readers and anyone who skips the notation. */
export function accuracyFormulaInWords(): string {
  return `In words: take e to the power of minus ${FORMULA.b} times the win% points the move lost, multiply by ${FORMULA.a}, subtract ${FORMULA.c} and add ${FORMULA.bonus}. A move that loses nothing scores 100; the score is kept between 0 and 100.`;
}

/** "win% = 50 + 50 × (2 / (1 + e^(−0.00368208 × centipawns)) − 1)". */
export function winFormula(): string {
  return `win% = 50 + 50 × (2 / (1 + e^(−${FORMULA.k} × centipawns)) − 1)`;
}

export function winFormulaNote(): string {
  return `The engine’s score in centipawns, from your side, capped at ±${FORMULA.clamp}. A forced mate counts as ${FORMULA.clamp}.`;
}

export function gameAccuracyText(): string {
  return `Game accuracy averages two means of your move scores. One is weighted by how sharp each moment was: the spread of win% over a window of ${WINDOW_MIN} to ${WINDOW_MAX} moves, about a tenth of the game. The other is a harmonic mean, so a single big error pulls the score down more than many small ones.`;
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-11" → "Nov 11, 2026" (a calendar date: no time zone involved). */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${MONTH[m - 1]} ${d}, ${y}`;
}

/** The engine line under the tabs (plan §4.5): engine, budget and the date the grading last changed. */
export function engineLine(): string {
  return `Engine: ${ENGINE_PROFILE.engine} on our server, ${num(ENGINE_PROFILE.pass1.nodes)} positions per move and ${num(ENGINE_PROFILE.pass2.nodes)} for key moments. Grading version ${GRADING_VERSION}, last changed ${formatDay(GRADING_CHANGED_AT)}.`;
}

export const ATTRIBUTION = "Opening evaluations from the Lichess open database, CC0.";

/** "Why analysis sometimes stops" (`#failures`, P3-Q11). */
export function failureParagraphs(): string[] {
  const attempts = JOB_MAX_ATTEMPTS.ANALYZE_GAME;
  return [
    "Every finished game is analysed on our server, one position at a time, and the progress is saved as it goes. Moves that are already graded stay on the review whatever happens next.",
    "Sometimes the engine stops: the server restarts, a deploy replaces it, or a search takes too long. The review then says how far it got and offers Retry Analysis. On its own, it tries again shortly afterwards.",
    `A retry continues from the last saved point, not from the first move. After ${attempts} attempts we stop and say so on the review; your moves and the graded part stay.`,
  ];
}
