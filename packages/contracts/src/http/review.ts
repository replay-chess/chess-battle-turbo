// HTTP contracts of Game Review (phase-03 plan §7.1, §7.2 A1–A8, §5.2, §5.3, §5.8). Registry entries live in
// registry/review.ts. Wire enums are lowercase (R-17); ids never leave the server, only refs (and share codes).
//
// Per-ply data is columnar and packed so a whole review is one ~4 KB payload (§9.2):
//   evals  White-POV centipawns, mate as sign·(30000 − n) (§8.1); evals[i] is the position before ply i
//   best   the engine's best move before each graded ply, UCI tokens separated by one space, "-" when unknown
//   j      one judgement char per graded ply (J_CHARS, indexed by the append-only JudgementCode of §8.16)
// Ply indexes are offsets from `game.startPly` (§8.1).
import { z } from "zod";
import { TimeClassWire } from "../socket/game";
import { Color, FenLoose, IsoDateTime, Ref, Uci } from "./common";
import { MAX_MOMENTS, PROGRESS_EVENTS_MAX } from "./plain";
import { ShareCode } from "./share";
import { MomentBankCard, MomentCard, ReviewBank } from "./train";

// The zod-free constants and paths of the review (plain.ts; the client imports them from there).
export {
  MAX_MOMENTS,
  PROGRESS_EVENTS_MAX,
  REVIEW_FALLBACK_SCHEDULE_MS,
  REVIEW_FALLBACK_STOP_AFTER_MS,
  REVIEW_STALL_SILENCE_MS,
  WORKER_STALL_HEARTBEAT_MS,
  annotatedPgnFilename,
  reviewPath,
} from "./plain";

// ── Judgements (§6.1, §8.16) ────────────────────────────────────────────────────────────────────────────────────
/** The 12 move-quality labels, in JudgementCode order 1…12 (code 0 = ungraded). Matches the board's MoveQuality. */
export const JUDGEMENT_KEYS = [
  "brilliant",
  "great",
  "best",
  "excellent",
  "good",
  "book",
  "forced",
  "interesting",
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
] as const;
export const JKey = z.enum(JUDGEMENT_KEYS);
export type JKey = z.infer<typeof JKey>;

/** `j` chars by JudgementCode: index 0 `.` ungraded, 1 `B` brilliant … 12 `X` blunder. Append-only. */
export const J_CHARS = ".BGbEgkFNIMSX";
/** Ungraded, plus one per label: the length of `analysis.counts.w|b`. */
export const JUDGEMENT_CODE_COUNT = 13;

/** The judgement of a `j` char; null for `.` (ungraded) and for anything outside J_CHARS. */
export function judgementOfChar(ch: string): JKey | null {
  const code = ch.length === 1 ? J_CHARS.indexOf(ch) : -1;
  return code >= 1 ? (JUDGEMENT_KEYS[code - 1] ?? null) : null;
}

/** The `j` char of a judgement (null → `.`). */
export function charOfJudgement(key: JKey | null): string {
  return key === null ? "." : J_CHARS.charAt(JUDGEMENT_KEYS.indexOf(key) + 1);
}

/** Longest game a review payload carries (plies), as the socket protocol's MAX_GAME_PLIES. */
export const REVIEW_MAX_PLIES = 1_200;

export const JString = z.string().max(REVIEW_MAX_PLIES).regex(/^[.BGbEgkFNIMSX]*$/);
/** Space-separated UCI tokens; `-` for an unknown best move. */
export const BestTokens = z
  .string()
  .max(REVIEW_MAX_PLIES * 6)
  .regex(/^(?:(?:[a-h][1-8][a-h][1-8][qrbn]?|-)(?: (?:[a-h][1-8][a-h][1-8][qrbn]?|-))*)?$/);
/** A White-POV eval: centipawns within ±9999, or a mate code sign·(30000 − n). */
export const EvalCode = z.number().int().min(-30_000).max(30_000);

/** The number of tokens of a `best` string (0 for ""). */
export function bestTokenCount(best: string): number {
  return best === "" ? 0 : best.split(" ").length;
}

// ── Analysis status and failures ────────────────────────────────────────────────────────────────────────────────
/** `games."analysisStatus"` on the wire (DB enum AnalysisStatus, lowercased). */
export const ANALYSIS_STATUSES = ["none", "queued", "running", "done", "failed", "skipped"] as const;
export const AnalysisStatusWire = z.enum(ANALYSIS_STATUSES);
export type AnalysisStatusWire = z.infer<typeof AnalysisStatusWire>;

/** Failure codes of `analysis:failed`, the review payload and A2. `worker_stalled` is A2's heartbeat rule (§8.12). */
export const ANALYSIS_FAILURE_CODES = ["engine_failed", "worker_stalled", "timeout", "internal"] as const;
export const AnalysisFailureCode = z.enum(ANALYSIS_FAILURE_CODES);
export type AnalysisFailureCode = z.infer<typeof AnalysisFailureCode>;

// ── Text (DB/src/json/review.ts stores the same shapes; P7 sets v = true for verifier-passed sentences) ──────────
export const Sentence = z.object({ t: z.string().max(400), v: z.boolean() });
export type Sentence = z.infer<typeof Sentence>;

export const PLAN_KEYS = ["attack", "defend", "trade", "improve", "unsure"] as const;
export const PlanKey = z.enum(PLAN_KEYS);
export type PlanKey = z.infer<typeof PlanKey>;

/** `player_reviews."textStatus"` (P3-D16): P3 writes `template`; the VERIFIED tag shows only for `ready` (P7). */
export const TEXT_STATUSES = ["pending", "template", "ready", "fallback"] as const;
export const TextStatus = z.enum(TEXT_STATUSES);
export type TextStatus = z.infer<typeof TextStatus>;

// ── Players ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const PLAYER_KINDS = ["member", "bot", "external", "legend"] as const;
export const PlayerKind = z.enum(PLAYER_KINDS);
export type PlayerKind = z.infer<typeof PlayerKind>;

/** A player chip, built from `game_players` + `users.name` + `opponentName/opponentRating` (§9.2). */
export const PlayerCard = z.object({
  name: z.string().min(1).max(120),
  rating: z.number().int().nullable(),
  initials: z.string().min(1).max(2),
  kind: PlayerKind,
  isYou: z.boolean(),
});
export type PlayerCard = z.infer<typeof PlayerCard>;

/** "17." for White's move 17, "17…" for Black's (§8.1 moveNo). */
export const MoveLabel = z.string().regex(/^[1-9]\d{0,3}(?:\.|…)$/);
export type MoveLabel = z.infer<typeof MoveLabel>;

/** A SAN move as shown (`Nxe3`, `O-O-O`, `exd8=Q+`, `Rd8#`). */
export const San = z.string().regex(/^(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?$/);
export type San = z.infer<typeof San>;

// ── Key moments (P3-D3: inside PlayerReview.content, ≤ 3; the API moment id is the ply) ─────────────────────────

export const MOMENT_RESULTS = ["found", "found_retry", "revealed"] as const;
export const MomentResult = z.enum(MOMENT_RESULTS);
export type MomentResult = z.infer<typeof MomentResult>;

export const MomentDTO = z.object({
  ply: z.number().int().min(0),
  moveLabel: MoveLabel,
  judgement: JKey,
  playedUci: Uci,
  playedSan: San,
  bestUci: Uci,
  bestSan: San,
  /** Every move within 2 Win% of the best (mover POV, MultiPV 3): the user "found" it iff their move is in here. */
  accept: z.array(Uci).min(1).max(3),
  /** The best line from the position before the moment, UCI space-separated, ≤ 8 plies (3–8; shorter only when it mates). */
  line: z.string().max(60).regex(/^[a-h][1-8][a-h][1-8][qrbn]?(?: [a-h][1-8][a-h][1-8][qrbn]?){0,7}$/),
  lineSan: z.string().max(120),
  /** Mover-POV Win% before and after the played move, 1 decimal. */
  winBefore: z.number().min(0).max(100),
  winAfter: z.number().min(0).max(100),
  /** The engine's idea class (§8.8). */
  intent: PlanKey,
  ask: z.string().max(300),
  why: z.array(Sentence).min(1).max(3),
  /** Chip feedback for all five chips, precomputed so a tap needs no network (§8.8). */
  plan: z.record(PlanKey, z.string().max(200)),
  /** !bankOptOut. The UI is hidden until P5's `train` flag (P3-D19). */
  inBank: z.boolean(),
  /**
   * P5 (phase-05 §7.1 MomentBank): the moment's BANK card when it exists ("Added · next review tomorrow"). Optional
   * and nullable: absent with the `train` flag off, null while the game is not extracted yet or the moment is out.
   */
  card: MomentCard.nullable().optional(),
  result: MomentResult.nullable(),
  attempts: z.number().int().min(0).max(50),
});
export type MomentDTO = z.infer<typeof MomentDTO>;

// ── The review payload: A1 `GET /api/review/[ref]` and the review RSC ───────────────────────────────────────────
export const ReviewRefParams = z.object({ ref: Ref });
export type ReviewRefParams = z.infer<typeof ReviewRefParams>;

export const GAME_MODES_WIRE = ["online", "friend", "bot", "legend_bot", "tournament", "imported"] as const;
export const ReviewGameMode = z.enum(GAME_MODES_WIRE);
export type ReviewGameMode = z.infer<typeof ReviewGameMode>;

export const GAME_SOURCES_WIRE = ["replay", "chesscom", "lichess"] as const;
export const GameSourceWire = z.enum(GAME_SOURCES_WIRE);
export type GameSourceWire = z.infer<typeof GameSourceWire>;

/** PGN results. `*` only for a game that never got a result (an aborted game, whose review is `skipped`). */
export const PgnResult = z.enum(["1-0", "0-1", "1/2-1/2", "*"]);
export type PgnResult = z.infer<typeof PgnResult>;

export const Opening = z.object({ eco: z.string().regex(/^[A-E]\d{2}$/), name: z.string().min(1).max(120) });
export type Opening = z.infer<typeof Opening>;

export const ReviewGame = z.object({
  mode: ReviewGameMode,
  source: GameSourceWire,
  startFen: FenLoose,
  startPly: z.number().int().min(0),
  tc: z.object({
    /** "Rapid 10+0", "Untimed". */
    label: z.string().max(40),
    timeClass: TimeClassWire.nullable(),
    initialSec: z.number().int().min(0),
    incSec: z.number().int().min(0),
  }),
  result: PgnResult,
  /** From `games."endMethod"`: "0–1 resigned". */
  endLabel: z.string().max(80),
  /** `games."completedAt"`. */
  playedAt: IsoDateTime,
  /** Server-rendered in `viewer.timeZone ?? "UTC"` (CDL §2.3 rule 6). */
  playedAtLabel: z.string().max(40),
  opening: Opening.nullable(),
  legend: z.object({ name: z.string().min(1).max(40), compareHref: z.string().startsWith("/review/") }).nullable(),
});
export type ReviewGame = z.infer<typeof ReviewGame>;

const SideNumbers = <T extends z.ZodType>(item: T) => z.object({ w: item, b: item });

export const ReviewFailure = z.object({
  failedAtPly: z.number().int().min(0),
  retryable: z.boolean(),
  retryAt: IsoDateTime.nullable(),
  code: AnalysisFailureCode,
});
export type ReviewFailure = z.infer<typeof ReviewFailure>;

export const QueueInfo = z.object({ position: z.number().int().min(0), etaSec: z.number().int().min(0) });
export type QueueInfo = z.infer<typeof QueueInfo>;

export const ReviewAnalysis = z
  .object({
    /** `GameAnalysis.version` = the GRADING_VERSION that wrote it (§8.14). */
    version: z.number().int().min(1),
    /** "Stockfish 18". */
    engineLabel: z.string().max(40),
    /** "depth 18". */
    depthLabel: z.string().max(40),
    gradedPlies: z.number().int().min(0),
    totalPlies: z.number().int().min(0).max(REVIEW_MAX_PLIES),
    evals: z.array(EvalCode).max(REVIEW_MAX_PLIES + 1),
    best: BestTokens,
    j: JString,
    /** Whole numbers, final only (null while not done, and for < 3 positions). */
    accuracy: SideNumbers(z.number().int().min(0).max(100).nullable()),
    /** Opening, middlegame, endgame; -1 for a phase not reached. */
    phaseAccuracy: SideNumbers(z.array(z.number().min(-1).max(100)).max(3)),
    phases: z.object({ middlegamePly: z.number().int().min(0).nullable(), endgamePly: z.number().int().min(0).nullable() }),
    /** Plies per JudgementCode (index 0 = ungraded), per side. */
    counts: SideNumbers(z.array(z.number().int().min(0)).length(JUDGEMENT_CODE_COUNT)),
    failure: ReviewFailure.nullable(),
    queue: QueueInfo.nullable(),
  })
  .superRefine((a, ctx) => {
    if (a.gradedPlies > a.totalPlies) ctx.addIssue({ code: "custom", path: ["gradedPlies"], message: "gradedPlies > totalPlies" });
    if (a.j.length > a.totalPlies) ctx.addIssue({ code: "custom", path: ["j"], message: "more judgements than plies" });
    if (a.evals.length > a.totalPlies + 1) ctx.addIssue({ code: "custom", path: ["evals"], message: "more evals than positions" });
    if (bestTokenCount(a.best) > a.totalPlies) ctx.addIssue({ code: "custom", path: ["best"], message: "more best moves than plies" });
  });
export type ReviewAnalysis = z.infer<typeof ReviewAnalysis>;

export const ReviewProgressDTO = z.object({
  momentIndex: z.number().int().min(0).max(MAX_MOMENTS),
  startedAt: IsoDateTime.nullable(),
  completedAt: IsoDateTime.nullable(),
});
export type ReviewProgressDTO = z.infer<typeof ReviewProgressDTO>;

export const ReviewContentDTO = z.object({
  textStatus: TextStatus,
  summary: z.array(Sentence).max(4),
  /** The game-over card line (COV C-02), ≤ 160 characters. */
  coachLine: Sentence.nullable(),
  /** "Opening equal · middlegame lost the thread · endgame not reached". */
  phaseLine: z.string().max(120),
  /** The archive note (≤ 80): "Missed Rxf5 · move 19". */
  headline: z.string().max(80).nullable(),
  isClean: z.boolean(),
  bestPly: z.number().int().min(0).nullable(),
  bestDecision: z.string().max(200).nullable(),
  moments: z.array(MomentDTO).max(MAX_MOMENTS),
  progress: ReviewProgressDTO,
});
export type ReviewContentDTO = z.infer<typeof ReviewContentDTO>;

/** The viewer's live REVIEW share of this game, if any (§5.4). */
export const ReviewShareInfo = z.object({
  code: ShareCode,
  url: z.url(),
  expiresAt: IsoDateTime,
  showUsername: z.boolean(),
});
export type ReviewShareInfo = z.infer<typeof ReviewShareInfo>;

export const ReviewDTO = z.object({
  v: z.literal(1),
  ref: Ref,
  status: AnalysisStatusWire,
  game: ReviewGame,
  players: z.object({ w: PlayerCard, b: PlayerCard }),
  you: Color,
  /** UCI moves from `startFen`, space-separated. */
  moves: z.string().max(REVIEW_MAX_PLIES * 6),
  /** SAN moves, space-separated (the move list and strip render without chess.js). */
  san: z.string().max(REVIEW_MAX_PLIES * 8),
  /** Remaining clock in ms after each ply (`games."moveClocksMs"`); empty for untimed games. */
  clocks: z.array(z.number().int().min(0)).max(REVIEW_MAX_PLIES),
  /**
   * Null only when no job exists (status `none` or `skipped`). Whenever a job exists (`queued`, `running`, `failed`,
   * `done`) it is non-null: a queued job with no checkpoint yet is a skeleton (`gradedPlies` 0, empty arrays, `queue`
   * set), so the client can splice the first `analysis:progress` frame into it (`mergePlies` in
   * @repo/chess-analysis/codec treats `null` as closed and would refetch A1 instead).
   */
  analysis: ReviewAnalysis.nullable(),
  /** The viewer's side only (never the opponent's review); null until done. */
  review: ReviewContentDTO.nullable(),
  share: ReviewShareInfo.nullable(),
});
export type ReviewDTO = z.infer<typeof ReviewDTO>;

// ── Legend summary (the game-over legend block §4.7, A2, the bot `complete` response) ───────────────────────────
/** `legend_comparisons.status` on the wire (DB enum ComparisonStatus, lowercased). */
export const COMPARISON_STATUSES = ["facts_ready", "narrating", "ready", "failed"] as const;
export const ComparisonStatusWire = z.enum(COMPARISON_STATUSES);
export type ComparisonStatusWire = z.infer<typeof ComparisonStatusWire>;

export const LegendResult = z.enum(["white_won", "black_won", "draw"]);
export type LegendResult = z.infer<typeof LegendResult>;

export const DivergenceBy = z.enum(["user", "opponent"]);
export type DivergenceBy = z.infer<typeof DivergenceBy>;

export const LegendRowMark = z.enum(["match", "split", "none"]);
export type LegendRowMark = z.infer<typeof LegendRowMark>;

export const LEGEND_SUMMARY_MAX_ROWS = 6;

export const LegendSummaryDTO = z.object({
  status: ComparisonStatusWire,
  legendName: z.string().min(1).max(40),
  legendResult: LegendResult,
  /** The member's plies that equal the legend's, and the plies compared (§8.9). */
  matched: z.number().int().min(0),
  compared: z.number().int().min(0),
  divergence: z
    .object({ ply: z.number().int().min(0), moveLabel: MoveLabel, userSan: San, legendSan: San, by: DivergenceBy })
    .nullable(),
  /** Up to 6 rows centred on the divergence: "12." · yours "Ba4" · the legend's "O-O-O" · split. */
  rows: z
    .array(z.object({ n: MoveLabel, yours: z.string().max(10), legend: z.string().max(10), mark: LegendRowMark }))
    .max(LEGEND_SUMMARY_MAX_ROWS),
  /** "Morphy won this; you drew." */
  outcomeLine: z.string().max(120),
  compareHref: z.string().startsWith("/review/"),
  /** `/practice?game=<ref>&ply=<divergencePly>`; null when the member followed the legend to the end. */
  replayHref: z.string().startsWith("/practice?").nullable(),
});
export type LegendSummaryDTO = z.infer<typeof LegendSummaryDTO>;

// ── A2 `GET /api/review/[ref]/status` (the fallback poller, the game-over card, the legend block) ──────────────
export const ReviewStatusDTO = z.object({
  v: z.literal(1),
  analysis: z.object({
    status: AnalysisStatusWire,
    gradedPlies: z.number().int().min(0),
    totalPlies: z.number().int().min(0),
    failedAtPly: z.number().int().min(0).nullable(),
    retryable: z.boolean(),
    retryAt: IsoDateTime.nullable(),
    code: AnalysisFailureCode.nullable(),
    etaSec: z.number().int().min(0).nullable(),
  }),
  review: z.object({
    ready: z.boolean(),
    accuracy: z.number().int().min(0).max(100).nullable(),
    momentsCount: z.number().int().min(0).max(MAX_MOMENTS),
    isClean: z.boolean(),
    coachLine: z.string().max(160).nullable(),
  }),
  comparison: LegendSummaryDTO.nullable(),
  /**
   * P5 (phase-05 §7.1 ReviewBank, COV C-01): the BANK cards that exist now for this game side's moment plies, which
   * the game-over line reads ("+2 positions added … (moves 13, 19)"). Null with the `train` flag off, or before the
   * game was extracted.
   */
  bank: ReviewBank.nullable(),
});
export type ReviewStatusDTO = z.infer<typeof ReviewStatusDTO>;

// ── A3 `POST …/analyse`, A4 `POST …/retry` ──────────────────────────────────────────────────────────────────────
export const AnalyseBody = z.object({ reason: z.enum(["opened", "regrade"]).default("opened") });
export type AnalyseBody = z.infer<typeof AnalyseBody>;
export type AnalyseBodyInput = z.input<typeof AnalyseBody>;

/** 202 (200 with `done` when the analysis is already done at the current GRADING_VERSION). */
export const AnalyseResponse = z.object({
  status: z.enum(["queued", "running", "done"]),
  /** Jobs ahead of this one (0 when running or done). */
  position: z.number().int().min(0),
  etaSec: z.number().int().min(0),
});
export type AnalyseResponse = z.infer<typeof AnalyseResponse>;

export const RetryBody = z.object({}).strict();
export type RetryBody = z.infer<typeof RetryBody>;

/** 202. Attempts are not reset; the job resumes from its last checkpoint. */
export const RetryResponse = z.object({
  status: z.literal("queued"),
  resumeFromPly: z.number().int().min(0),
  etaSec: z.number().int().min(0),
});
export type RetryResponse = z.infer<typeof RetryResponse>;

// ── A5 `PATCH …/progress` (JSON, or text/plain JSON for keepalive/beacon) → 204 ─────────────────────────────────
/** A5 bodies above this are 413. */
export const PROGRESS_BODY_MAX_BYTES = 8_192;

export const PROGRESS_EVENT_TYPES = ["viewed", "attempt", "plan_picked", "revealed", "show_line"] as const;

export const ProgressEvent = z.object({
  type: z.enum(PROGRESS_EVENT_TYPES),
  ply: z.number().int().min(0),
  at: IsoDateTime,
  uci: Uci.optional(),
  correct: z.boolean().optional(),
  chip: PlanKey.optional(),
});
export type ProgressEvent = z.infer<typeof ProgressEvent>;

export const ProgressBody = z.object({
  momentIndex: z.number().int().min(0).max(MAX_MOMENTS),
  events: z.array(ProgressEvent).max(PROGRESS_EVENTS_MAX),
});
export type ProgressBody = z.infer<typeof ProgressBody>;

// ── A6 `PATCH …/moments/[ply]` ──────────────────────────────────────────────────────────────────────────────────
export const MomentParams = z.object({ ref: Ref, ply: z.coerce.number().int().min(0).max(REVIEW_MAX_PLIES) });
export type MomentParams = z.infer<typeof MomentParams>;

export const MomentBankBody = z.object({ inBank: z.boolean() });
export type MomentBankBody = z.infer<typeof MomentBankBody>;

/** `card` (P5): the BANK card after the write; null while the game is not extracted yet, or with `inBank` false. */
export const MomentBankResponse = z.object({ ply: z.number().int().min(0), inBank: z.boolean(), card: MomentBankCard.nullable() });
export type MomentBankResponse = z.infer<typeof MomentBankResponse>;

// ── A7 `POST …/complete` (a replay answers the same body) ───────────────────────────────────────────────────────
export const CompleteOut = z.object({
  accuracy: z.number().int().min(0).max(100).nullable(),
  moments: z.number().int().min(0).max(MAX_MOMENTS),
  found: z.number().int().min(0).max(MAX_MOMENTS),
  revealed: z.number().int().min(0).max(MAX_MOMENTS),
  isClean: z.boolean(),
  bestThisMonth: z.boolean(),
  completedAt: IsoDateTime,
});
export type CompleteOut = z.infer<typeof CompleteOut>;

// ── The `/review/[ref]/complete` RSC view (getReviewComplete, §5.3; no client fetch) ────────────────────────────
export const CompleteMoment = z.object({
  ply: z.number().int().min(0),
  moveLabel: MoveLabel,
  /** The position after the played move (the 56 px mini board). */
  fenAfter: FenLoose,
  playedSan: San,
  bestSan: San,
  judgement: JKey,
  /** The first `why` sentence. */
  why0: z.string().max(400).nullable(),
  result: MomentResult.nullable(),
  /** P5: the "Added" / "Not added" tag (a BANK card exists for this moment). Absent with the `train` flag off. */
  inBank: z.boolean().optional(),
});
export type CompleteMoment = z.infer<typeof CompleteMoment>;

/** A standout move of a clean game (brilliant, great, the mating move). */
export const CompleteStandout = z.object({
  ply: z.number().int().min(0),
  moveLabel: MoveLabel,
  fenAfter: FenLoose,
  san: San,
  judgement: JKey,
  caption: z.string().max(200),
});
export type CompleteStandout = z.infer<typeof CompleteStandout>;

export const ReviewCompleteView = z.object({
  v: z.literal(1),
  ref: Ref,
  header: z.object({
    /** "Review · vs tal_fan_77 · 0–1". */
    eyebrow: z.string().max(160),
    opponentName: z.string().max(120),
    resultLabel: z.string().max(12),
  }),
  accuracy: z.number().int().min(0).max(100).nullable(),
  moments: z.array(CompleteMoment).max(MAX_MOMENTS),
  /** Moments found on the first try or on a retry. */
  found: z.number().int().min(0).max(MAX_MOMENTS),
  /** Moments with any result (the "2 of 3 moments reviewed" line). */
  reviewed: z.number().int().min(0).max(MAX_MOMENTS),
  isClean: z.boolean(),
  bestDecision: z.string().max(200).nullable(),
  /** Brilliant moves of the viewer's side (the clean-game stat tile). */
  brilliant: z.number().int().min(0),
  standouts: z.array(CompleteStandout).max(MAX_MOMENTS),
  bestThisMonth: z.boolean(),
  /** Finish was pressed before every moment had a result, or the page was opened directly (`completedAt IS NULL`). */
  partial: z.boolean(),
  shareEnabled: z.boolean(),
  // P5 (phase-05 §4.8, §3.2): the Mistake Bank lines. All absent with the `train` flag off.
  /** "3 added to your Mistake Bank": the BANK cards that exist for this side's moments. */
  added: z.number().int().min(0).max(MAX_MOMENTS).optional(),
  /** The earliest due of those cards ("The first one comes back tomorrow"); null when none was added. */
  nextDueAt: IsoDateTime.nullable().optional(),
  /** "tomorrow", "Saturday", "Nov 6" in the viewer's zone; null when none was added. */
  nextDueLabel: z.string().max(16).nullable().optional(),
  /** `/train/bank/session?game=<ref>` ("Drill These 3 Mistakes"); null when none was added. */
  drillHref: z.string().startsWith("/train/bank/session?").max(200).nullable().optional(),
});
export type ReviewCompleteView = z.infer<typeof ReviewCompleteView>;

// ── A8 `GET …/pgn`: text/x-chess-pgn, `private, no-store`, attachment ───────────────────────────────────────────
export const AnnotatedPgnText = z.string();
