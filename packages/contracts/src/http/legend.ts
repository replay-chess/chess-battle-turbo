// Compare with the legend (phase-03 plan §4.6, §5.7, §7.1, §7.2 A9/A9b, §8.9; P3-D24). Registry entries live in
// registry/review.ts. A9 never enqueues engine work: its only GET write is the derived `legend_facts` insert. The
// engine evals at the divergence come from A9b (`POST …/legend/compute`) → LEGEND_COMPARE → `compare:ready`.
import { z } from "zod";
import { Color, FenLoose, IsoDateTime, Ref, Uci } from "./common";
import {
  AnalysisStatusWire,
  ComparisonStatusWire,
  DivergenceBy,
  LegendResult,
  LegendRowMark,
  MoveLabel,
  PlayerCard,
  San,
} from "./review";
import { LEGEND_COMPUTE_MAX_ATTEMPTS } from "./plain";

// The zod-free compare constants and path (plain.ts; the client imports them from there).
export { LEGEND_COMPUTE_MAX_ATTEMPTS, legendComparePath } from "./plain";

/** The longest line a comparison stores per side (plies from `startPly`, §6.6 ComparisonFactsV1). */
export const LEGEND_LINE_MAX_PLIES = 120;

/** `?include=explanation` adds the ~20 KB static narration; only the Explanation tab asks for it (§5.7). */
export const LegendCompareQuery = z.object({ include: z.enum(["explanation"]).optional() });
export type LegendCompareQuery = z.infer<typeof LegendCompareQuery>;

// ── The static explanation (`chess_positions.explanation`, authored content; the legacy ExplanationData) ──────
export const EXPLANATION_VISUAL_TYPES = [
  "highlight",
  "arrow",
  "showMove",
  "clearVisuals",
  "resetBoard",
  "undoMoves",
  "annotateSquare",
  "annotate",
  "showEvalBar",
] as const;

/** One board cue. Loose: authored JSON may carry presentation keys a newer player understands. */
export const ExplanationVisual = z.looseObject({
  type: z.enum(EXPLANATION_VISUAL_TYPES),
  squares: z.array(z.string()).optional(),
  color: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  san: z.string().optional(),
  count: z.number().optional(),
  square: z.string().optional(),
  symbol: z.string().optional(),
  icon: z.string().optional(),
  score: z.number().optional(),
  description: z.string().optional(),
  triggerTime: z.number().optional(),
});
export type ExplanationVisual = z.infer<typeof ExplanationVisual>;

export const ExplanationSegment = z.object({
  visuals: z.array(ExplanationVisual),
  narration: z.string(),
  /** Seconds into the audio. */
  startTime: z.number().min(0),
  endTime: z.number().min(0),
});
export type ExplanationSegment = z.infer<typeof ExplanationSegment>;

export const StaticExplanation = z.object({
  fen: z.string(),
  segments: z.array(ExplanationSegment),
  audioFile: z.string().optional(),
  alignment: z
    .object({ words: z.array(z.string()), startTimes: z.array(z.number()), endTimes: z.array(z.number()) })
    .optional(),
  generatedAt: z.string().optional(),
});
export type StaticExplanation = z.infer<typeof StaticExplanation>;

// ── A9 `GET /api/review/[ref]/legend` ───────────────────────────────────────────────────────────────────────────
/** One table row of the Your Moves / the legend's Moves tabs: "12." · White · Black · mark (yours only). */
export const LegendLineRow = z.object({
  n: z.string().regex(/^[1-9]\d{0,3}\.$/),
  w: z.string().max(10).nullable(),
  b: z.string().max(10).nullable(),
  /** `match` both sides matched the legend, `split` the row of the divergence, `none` after it (or the legend's own rows). */
  mark: LegendRowMark,
});
export type LegendLineRow = z.infer<typeof LegendLineRow>;

export const LegendLine = z.object({
  /** UCI from `startPly`, space-separated (the board steps along it). */
  uci: z.string().max(LEGEND_LINE_MAX_PLIES * 6),
  rows: z.array(LegendLineRow).max(LEGEND_LINE_MAX_PLIES / 2 + 1),
});
export type LegendLine = z.infer<typeof LegendLine>;

/**
 * play-b F6's LegendComparisonDTO with `hasExplanation` in place of `staticExplanation` (the explanation comes with
 * `?include=explanation`), `evalAtDivergence` added, and lowercase statuses (§7.1).
 */
export const LegendCompareDTO = z.object({
  v: z.literal(1),
  ref: Ref,
  status: ComparisonStatusWire,
  /** Compute attempts used (A9b; 410 after LEGEND_COMPUTE_MAX_ATTEMPTS). */
  attempts: z.number().int().min(0).max(LEGEND_COMPUTE_MAX_ATTEMPTS),
  /** The client sends A9b once only when the game's analysis is done and the evals are missing (§5.7). */
  analysisStatus: AnalysisStatusWire,
  legend: z.object({
    /** "Morphy" (≤ 40, `ComparisonFactsV1.historicalName`). */
    name: z.string().min(1).max(40),
    /** "Paul Morphy". */
    fullName: z.string().min(1).max(120),
    year: z.number().int().min(1400).max(2100).nullable(),
    /** "Opera Game, Paris 1858". */
    title: z.string().max(160),
    positionRef: Ref,
  }),
  you: Color,
  players: z.object({ w: PlayerCard, b: PlayerCard }),
  startFen: FenLoose,
  startPly: z.number().int().min(0),
  matched: z.number().int().min(0),
  compared: z.number().int().min(0),
  divergence: z
    .object({
      ply: z.number().int().min(0),
      moveLabel: MoveLabel,
      by: DivergenceBy,
      userUci: Uci,
      userSan: San,
      legendUci: Uci,
      legendSan: San,
      /** The position both moves were played from (the board's default view, with the two arrows). */
      fenBefore: FenLoose,
    })
    .nullable(),
  /** Member-POV Win% after each move at the pass-2 budget; null until LEGEND_COMPARE (or pass 2) fills it. */
  evalAtDivergence: z.object({ userWin: z.number().min(0).max(100), legendWin: z.number().min(0).max(100) }).nullable(),
  legendResult: LegendResult,
  legendTotalMoves: z.number().int().min(1).nullable(),
  userResult: z.enum(["win", "loss", "draw"]),
  /** "You matched 2 of 3 moves, then left his path with 12.Ba4." */
  summaryLine: z.string().max(200),
  /** The template comparison paragraph of the Explanation tab (§8.9). */
  paragraph: z.string().max(600),
  /** "Morphy won this; you drew." */
  outcomeLine: z.string().max(120),
  yourLine: LegendLine,
  legendLine: LegendLine,
  practice: z.object({
    /** The divergence ply, or the last compared ply when the member followed the legend. */
    ply: z.number().int().min(0),
    href: z.string().startsWith("/practice?"),
    botElo: z.number().int().min(400).max(3_200),
  }),
  hasExplanation: z.boolean(),
  /** Present only with `?include=explanation` and when `hasExplanation`. */
  explanation: StaticExplanation.nullable(),
  /** `chess_positions."explanationAudioUrl"`; `preload="none"`, loaded on Play. */
  audioUrl: z.url().nullable(),
  updatedAt: IsoDateTime,
});
export type LegendCompareDTO = z.infer<typeof LegendCompareDTO>;

// ── A9b `POST /api/review/[ref]/legend/compute` → 202 ───────────────────────────────────────────────────────────
export const LegendComputeBody = z.object({}).strict();
export type LegendComputeBody = z.infer<typeof LegendComputeBody>;

export const LegendComputeResponse = z.object({ status: z.literal("computing") });
export type LegendComputeResponse = z.infer<typeof LegendComputeResponse>;
