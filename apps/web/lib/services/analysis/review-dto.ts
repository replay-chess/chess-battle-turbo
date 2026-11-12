// Review DTO builders (phase-03 plan §7.1 ReviewDTO / ReviewStatusDTO / ReviewCompleteView, §9.2 "DTO build").
// Pure: rows in (lib/services/analysis/review-sql.ts), contract shapes out (@repo/contracts/http/review). Only refs
// and share codes leave the server; BigInt ids never do.
//
// SAN is not stored: it is derived from `games.moves` with chess.js and memoised per game ref and ply count in a
// module-scope LRU (500 entries, OPT §4.5). The memo holds move text and positions of a game only, keyed by its ref.
import { encodeBestTokens, encodeJudgements, judgementKey, moveLabel, moverAt } from "@repo/chess-analysis/codec";
import { legendSummary } from "@repo/chess-analysis/legend/summary";
import { outcomeForMember } from "@repo/chess-analysis/legend/slice";
import { ENGINE_PROFILE, GRADING_VERSION } from "@repo/chess-analysis/version";
import { legendComparePath } from "@repo/contracts/http/legend";
import {
  JUDGEMENT_CODE_COUNT,
  MAX_MOMENTS,
  REVIEW_MAX_PLIES,
  type CompleteMoment,
  type CompleteOut,
  type CompleteStandout,
  type JKey,
  type LegendSummaryDTO,
  type MomentDTO,
  type PlayerCard,
  type PlayerKind,
  type ReviewAnalysis,
  type ReviewCompleteView,
  type ReviewContentDTO,
  type ReviewDTO,
  type ReviewStatusDTO,
  judgementOfChar,
} from "@repo/contracts/http/review";
import { parseComparisonFacts, parseReviewContent, parseReviewProgress, type ComparisonFactsV1 } from "@repo/db/json";
import type { ReviewContentV1, ReviewMomentV1, ReviewProgressV1 } from "@repo/db/json";
import { initialsOf } from "@repo/game-core/rules/describe";
import { timeLabel, wireTimeClass } from "@repo/game-core/rules/timeClass";
import { Chess } from "chess.js";
import { LRUCache } from "lru-cache";
import { analysisStateOf, etaSecFor, type AnalysisState } from "./state";
import type { GameColumns, PlayerColumns, ProbeRow, ReviewRow, StatusRow } from "./review-sql";
import { historicalFullName, historicalShortName } from "./legend-facts";

// ── Replay memo ──────────────────────────────────────────────────────────────────────────────────────────────────
export type Replayed = {
  /** The UCI moves that replay (a legacy row with an illegal move is cut there). */
  uci: string[];
  san: string[];
  /** FEN before each ply, and the final position (length uci.length + 1). */
  fens: string[];
};

export const SAN_MEMO_MAX = 500;
const replayMemo = new LRUCache<string, Replayed>({ max: SAN_MEMO_MAX });

/** Replays UCI moves from a FEN, stopping at the first move chess.js rejects. */
export function replayMoves(startFen: string, moves: string): Replayed {
  const out: Replayed = { uci: [], san: [], fens: [] };
  let chess: Chess;
  try {
    chess = new Chess(startFen);
  } catch {
    return { uci: [], san: [], fens: [startFen] };
  }
  out.fens.push(chess.fen());
  for (const uci of moves.trim() === "" ? [] : moves.trim().split(/\s+/)) {
    try {
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
      out.uci.push(`${m.from}${m.to}${m.promotion ?? ""}`);
      out.san.push(m.san);
      out.fens.push(chess.fen());
    } catch {
      break;
    }
  }
  return out;
}

/** replayMoves, memoised by ref, move-text length and start (a game's moves only grow, and never change once over). */
export function replayedGame(ref: string, startFen: string, moves: string): Replayed {
  const key = `${ref}:${moves.length}:${startFen}`;
  const hit = replayMemo.get(key);
  if (hit) return hit;
  const replayed = replayMoves(startFen, moves);
  replayMemo.set(key, replayed);
  return replayed;
}

/** SAN of a line of UCI moves from a FEN (stops at the first illegal move). */
export function lineSanOf(fen: string, uci: readonly string[]): string[] {
  return replayMoves(fen, uci.join(" ")).san;
}

// ── Labels ───────────────────────────────────────────────────────────────────────────────────────────────────────
type Outcome = GameColumns["outcome"];

export function pgnResultOf(outcome: Outcome): ReviewDTO["game"]["result"] {
  if (outcome === "WHITE") return "1-0";
  if (outcome === "BLACK") return "0-1";
  if (outcome === "DRAW") return "1/2-1/2";
  return "*";
}

const END_WORDS: Record<string, string> = {
  CHECKMATE: "checkmate",
  RESIGNATION: "resigned",
  TIMEOUT: "on time",
  TIMEOUT_VS_INSUFFICIENT: "on time, insufficient material",
  STALEMATE: "stalemate",
  THREEFOLD: "repetition",
  FIFTY_MOVE: "50-move rule",
  INSUFFICIENT_MATERIAL: "insufficient material",
  AGREEMENT: "agreed",
  ABANDONED: "abandoned",
  ABORTED: "aborted",
};

/** "0–1 resigned", "½–½ agreed", "1–0 checkmate"; "Aborted" for a game without a result. */
export function endLabelOf(outcome: Outcome, endMethod: string | null): string {
  const result = outcome === "WHITE" ? "1–0" : outcome === "BLACK" ? "0–1" : outcome === "DRAW" ? "½–½" : null;
  const word = endMethod ? END_WORDS[endMethod] : undefined;
  if (!result) return endMethod === "ABORTED" || outcome === "NONE" ? "Aborted" : "Unfinished";
  return word ? `${result} ${word}` : result;
}

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "Nov 9" this year, "Nov 9, 2025" otherwise (viewer.timeZone ?? "UTC"; users have no time zone until P4). */
export function playedAtLabelOf(at: Date, nowMs: number): string {
  return at.getUTCFullYear() === new Date(nowMs).getUTCFullYear() ? MONTH.format(at) : MONTH_YEAR.format(at);
}

export function tcOf(g: Pick<GameColumns, "timeClass" | "initialTimeSeconds" | "incrementSeconds">): ReviewDTO["game"]["tc"] {
  const untimed = g.timeClass === "UNTIMED" || (g.initialTimeSeconds <= 0 && g.incrementSeconds <= 0);
  return {
    label: untimed ? "Untimed" : timeLabel({ initialSeconds: g.initialTimeSeconds, incrementSeconds: g.incrementSeconds }),
    timeClass: g.timeClass ? wireTimeClass(g.timeClass) : null,
    initialSec: Math.max(0, g.initialTimeSeconds),
    incSec: Math.max(0, g.incrementSeconds),
  };
}

const GAME_MODE_WIRE: Record<NonNullable<GameColumns["mode"]>, ReviewDTO["game"]["mode"]> = {
  LEGEND_BOT: "legend_bot",
  BOT: "bot",
  FRIEND: "friend",
  ONLINE: "online",
  TOURNAMENT: "tournament",
  IMPORTED: "imported",
};

export function opponentKindOf(input: {
  opponentUserId: bigint | null;
  mode: GameColumns["mode"];
  source: GameColumns["source"];
  opponentIsLegend: boolean;
}): PlayerKind {
  if (input.opponentUserId != null) return "member";
  if (input.mode === "BOT" || input.mode === "LEGEND_BOT") return "bot";
  if (input.source !== "REPLAY") return "external";
  if (input.opponentIsLegend) return "legend";
  return "member";
}

function card(name: string | null | undefined, fallback: string, rating: number | null, kind: PlayerKind, isYou: boolean): PlayerCard {
  const display = (name ?? "").trim().slice(0, 120) || fallback;
  return { name: display, rating: rating ?? null, initials: initialsOf(display).slice(0, 2) || "?", kind, isYou };
}

/** Both player chips (§9.2): "you" from users.name + ratingBefore, the opponent from the game_players snapshot. */
export function playerCardsOf(
  row: ProbeRow & PlayerColumns & Pick<GameColumns, "mode" | "source">,
  opponentIsLegend = false,
): ReviewDTO["players"] {
  const you = card(row.youName, "You", row.ratingBefore, "member", row.isPlayer);
  const kind = opponentKindOf({ opponentUserId: row.opponentUserId, mode: row.mode, source: row.source, opponentIsLegend });
  const opp = card(row.opponentName, kind === "bot" ? "Engine" : "Opponent", row.opponentRating, kind, false);
  return row.color === "w" ? { w: you, b: opp } : { w: opp, b: you };
}

const round = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : Math.round(v));
const roundPhases = (v: number[] | null | undefined): number[] =>
  (v ?? []).slice(0, 3).map((x) => (x < 0 ? -1 : Math.min(100, Math.round(x))));
const iso = (d: Date | null | undefined): string | null => (d == null ? null : new Date(d).toISOString());

// ── The analysis block ──────────────────────────────────────────────────────────────────────────────────────────
function countsFromJudgements(judgements: readonly number[], graded: number, total: number, startMover: "w" | "b") {
  const w = Array<number>(JUDGEMENT_CODE_COUNT).fill(0);
  const b = Array<number>(JUDGEMENT_CODE_COUNT).fill(0);
  for (let i = 0; i < total; i++) {
    const side = moverAt(i, startMover) === "w" ? w : b;
    const code = i < graded ? (judgements[i] ?? 0) : 0;
    side[code >= 0 && code < JUDGEMENT_CODE_COUNT ? code : 0]! += 1;
  }
  return { w, b };
}

const fullCounts = (v: number[] | null | undefined): number[] | null =>
  v && v.length === JUDGEMENT_CODE_COUNT ? v.map((x) => Math.max(0, Math.round(x))) : null;

function startMoverOf(fen: string): "w" | "b" {
  return fen.trim().split(/\s+/)[1] === "b" ? "b" : "w";
}

/** `queue` for a queued job: jobs ahead and the ETA. */
export function queueInfoOf(state: AnalysisState, queueAhead: number | null, totalPlies: number, gradedPlies: number) {
  if (state.status !== "queued") return null;
  const position = Math.max(0, queueAhead ?? 0);
  return { position, etaSec: etaSecFor({ position, totalPlies, gradedPlies }) };
}

export function analysisOf(row: ReviewRow, state: AnalysisState): ReviewAnalysis | null {
  if (state.status === "none" || state.status === "skipped") return null;
  const total = Math.min(REVIEW_MAX_PLIES, Math.max(0, row.totalPlies ?? row.plyCount));
  const graded = Math.min(total, Math.max(0, row.gradedPlies ?? 0));
  const judgements = (row.judgements ?? []).slice(0, graded);
  const done = state.status === "done";
  const mine = row.color;
  const accuracyOf = (side: "w" | "b") => {
    if (!done) return null;
    const own = side === mine ? row.myAccuracy : row.oppAccuracy;
    return round(own ?? (side === "w" ? row.accuracyWhite : row.accuracyBlack));
  };
  const computed = countsFromJudgements(row.judgements ?? [], graded, total, startMoverOf(row.startingFen));
  const countsW = done ? fullCounts(row.countsWhite) : null;
  const countsB = done ? fullCounts(row.countsBlack) : null;
  return {
    version: row.version ?? GRADING_VERSION,
    engineLabel: ENGINE_PROFILE.engine,
    depthLabel: row.depthP50 ? `depth ${row.depthP50}` : `${Math.round(ENGINE_PROFILE.pass1.nodes / 1000)}k nodes`,
    gradedPlies: graded,
    totalPlies: total,
    evals: (row.evals ?? []).slice(0, graded + 1),
    best: encodeBestTokens((row.best ?? []).slice(0, graded)),
    j: encodeJudgements(judgements),
    accuracy: { w: accuracyOf("w"), b: accuracyOf("b") },
    phaseAccuracy: done
      ? {
          w: roundPhases(mine === "w" ? row.myPhaseAccuracy : row.oppPhaseAccuracy),
          b: roundPhases(mine === "b" ? row.myPhaseAccuracy : row.oppPhaseAccuracy),
        }
      : { w: [], b: [] },
    phases: { middlegamePly: row.middlegamePly ?? null, endgamePly: row.endgamePly ?? null },
    counts: { w: countsW ?? computed.w, b: countsB ?? computed.b },
    failure: state.failure,
    queue: queueInfoOf(state, row.queueAhead, total, graded),
  };
}

// ── The viewer's review (content + progress) ────────────────────────────────────────────────────────────────────
const TEXT_STATUS: Record<string, ReviewContentDTO["textStatus"]> = {
  PENDING: "pending",
  TEMPLATE: "template",
  READY: "ready",
  FALLBACK: "fallback",
};

const RESULT_WIRE = { FOUND: "found", FOUND_RETRY: "found_retry", REVEALED: "revealed" } as const;

const UCI_LINE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export function momentOf(m: ReviewMomentV1, progress: ReviewProgressV1, replay: Replayed, startPly: number): MomentDTO | null {
  const fen = replay.fens[m.ply];
  const judgement = judgementKey(m.judgement) as JKey | null;
  if (fen === undefined || !judgement) return null;
  const playedSan = replay.uci[m.ply] === m.playedUci ? replay.san[m.ply] : lineSanOf(fen, [m.playedUci])[0];
  const bestSan = lineSanOf(fen, [m.bestUci])[0];
  if (!playedSan || !bestSan) return null;
  const pv = m.pv.split(" ").filter((t) => UCI_LINE.test(t)).slice(0, 8);
  const line = pv.length ? pv : [m.bestUci];
  const lineSan = lineSanOf(fen, line).join(" ").slice(0, 120);
  const result = progress.results[String(m.ply)];
  return {
    ply: m.ply,
    moveLabel: moveLabel(m.ply, startPly),
    judgement,
    playedUci: m.playedUci,
    playedSan,
    bestUci: m.bestUci,
    bestSan,
    accept: m.accept.length ? m.accept.slice(0, 3) : [m.bestUci],
    line: line.join(" "),
    lineSan,
    winBefore: m.winBefore,
    winAfter: m.winAfter,
    intent: m.intent,
    ask: m.ask,
    why: m.why.length ? m.why : [{ t: `${bestSan} was the engine’s move here.`, v: false }],
    plan: m.plan,
    inBank: !progress.bankOptOut.includes(m.ply),
    result: result ? RESULT_WIRE[result] : null,
    attempts: Math.min(50, progress.attempts[String(m.ply)] ?? 0),
  };
}

export function reviewContentOf(
  row: Pick<ReviewRow, "content" | "progress" | "textStatus" | "reviewStartedAt" | "reviewCompletedAt" | "startPly">,
  replay: Replayed,
): ReviewContentDTO | null {
  const content: ReviewContentV1 | null = parseReviewContent(row.content);
  if (!content) return null;
  const progress = parseReviewProgress(row.progress) ?? parseReviewProgress(null)!;
  const moments = content.moments
    .map((m) => momentOf(m, progress, replay, row.startPly))
    .filter((m): m is MomentDTO => m !== null)
    .slice(0, MAX_MOMENTS);
  return {
    textStatus: TEXT_STATUS[row.textStatus ?? ""] ?? "template",
    summary: content.summary,
    coachLine: content.coachLine,
    phaseLine: content.phaseLine,
    headline: content.headline,
    isClean: content.isClean,
    bestPly: content.bestPly,
    bestDecision: content.bestDecision,
    moments,
    progress: {
      momentIndex: progress.momentIndex,
      startedAt: iso(row.reviewStartedAt),
      completedAt: iso(row.reviewCompletedAt),
    },
  };
}

// ── Legend name on the review (game.legend) ─────────────────────────────────────────────────────────────────────
/** The legend the member is compared with: the facts row's name, else the position's side name (when it has a PGN). */
export function legendNameOf(row: ReviewRow): string | null {
  if (row.legendName) return row.legendName;
  if (row.chessPositionId == null || !row.legendHasPgn) return null;
  const full = historicalFullName(row, row.color);
  return full ? historicalShortName(full) : null;
}

// ── ReviewDTO (A1) ───────────────────────────────────────────────────────────────────────────────────────────────
export type BuildOptions = { nowMs: number; siteOrigin: string };

export function buildReviewDTO(row: ReviewRow, opts: BuildOptions): ReviewDTO {
  const state = analysisStateOf(row, opts.nowMs);
  const replay = replayedGame(row.ref, row.startingFen, row.moves);
  const legendName = legendNameOf(row);
  const opponentSide = row.color === "w" ? "b" : "w";
  const opponentIsLegend = row.chessPositionId != null && historicalFullName(row, opponentSide) !== null;
  const opening =
    row.ecoCode && /^[A-E]\d{2}$/.test(row.ecoCode) && row.openingName
      ? { eco: row.ecoCode, name: row.openingName.slice(0, 120) }
      : null;
  const review = state.status === "done" ? reviewContentOf(row, replay) : null;
  const clocks = (row.moveClocksMs ?? []).slice(0, replay.uci.length).map((c) => Math.max(0, Math.round(c)));
  return {
    v: 1,
    ref: row.ref,
    status: state.status,
    game: {
      mode: row.mode ? GAME_MODE_WIRE[row.mode] : "online",
      source: row.source === "CHESSCOM" ? "chesscom" : row.source === "LICHESS" ? "lichess" : "replay",
      startFen: row.startingFen,
      startPly: row.startPly,
      tc: tcOf(row),
      result: pgnResultOf(row.outcome),
      endLabel: endLabelOf(row.outcome, row.endMethod),
      playedAt: new Date(row.playedAt).toISOString(),
      playedAtLabel: playedAtLabelOf(new Date(row.playedAt), opts.nowMs),
      opening,
      legend: legendName ? { name: legendName, compareHref: legendComparePath(row.ref) } : null,
    },
    players: playerCardsOf(row, opponentIsLegend),
    you: row.color,
    moves: replay.uci.join(" "),
    san: replay.san.join(" "),
    clocks,
    analysis: analysisOf(row, state),
    review,
    share:
      row.shareCode && row.shareExpiresAt
        ? {
            code: row.shareCode,
            url: `${opts.siteOrigin}/r/${row.shareCode}`,
            expiresAt: new Date(row.shareExpiresAt).toISOString(),
            showUsername: row.shareShowUsername ?? true,
          }
        : null,
  };
}

// ── ETags (A1 and A2: the same value from the probe row and from the full row) ──────────────────────────────────
const epoch = (d: Date | null | undefined): number => (d == null ? 0 : new Date(d).getTime());

function statusToken(state: AnalysisState): string {
  return state.failure ? `${state.status}.${state.failure.retryable ? "r" : "t"}.${state.failure.code}` : state.status;
}

/** A1: `r1-<version>-<gradedPlies>-<status>-<reviewUpdated>-<share|0>-<side><viewer|admin>` (strong). */
export function reviewEtag(row: ProbeRow, nowMs: number): string {
  const state = analysisStateOf(row, nowMs);
  const updated = Math.max(epoch(row.reviewUpdatedAt), epoch(row.analysisUpdatedAt));
  const share = row.shareCode ? `${row.shareCode}${row.shareShowUsername ? "u" : "n"}` : "0";
  return `r1-${row.version ?? 0}-${row.gradedPlies ?? 0}-${statusToken(state)}-${updated}-${share}-${row.color}${row.isPlayer ? "p" : "a"}`;
}

/** A2: the probe values plus the comparison state. */
export function statusEtag(row: ProbeRow, nowMs: number): string {
  const state = analysisStateOf(row, nowMs);
  const updated = Math.max(epoch(row.reviewUpdatedAt), epoch(row.analysisUpdatedAt));
  const comparison = row.comparisonStatus ? `${row.comparisonStatus}.${epoch(row.comparisonUpdatedAt)}` : "x";
  return `s1-${statusToken(state)}-${row.gradedPlies ?? 0}-${row.totalPlies ?? 0}-${row.version ?? 0}-${updated}-${comparison}-${row.color}`;
}

// ── ReviewStatusDTO (A2) ─────────────────────────────────────────────────────────────────────────────────────────
const COMPARISON_WIRE = {
  FACTS_READY: "facts_ready",
  NARRATING: "narrating",
  READY: "ready",
  FAILED: "failed",
} as const;

/** The game-over legend block / A2 `comparison` from a facts row. */
export function legendSummaryOf(
  ref: string,
  startFen: string,
  status: keyof typeof COMPARISON_WIRE,
  facts: ComparisonFactsV1,
  outcome: Outcome,
): LegendSummaryDTO {
  return {
    status: COMPARISON_WIRE[status],
    compareHref: legendComparePath(ref),
    ...legendSummary({ startFen, facts }, ref, outcomeForMember(outcome, facts.side)),
  };
}

export function buildStatusDTO(
  row: StatusRow,
  opts: { nowMs: number; comparison: { status: keyof typeof COMPARISON_WIRE; facts: unknown } | null },
): ReviewStatusDTO {
  const state = analysisStateOf(row, opts.nowMs);
  const total = Math.max(0, row.totalPlies ?? row.plyCount);
  const graded = Math.min(total, Math.max(0, row.gradedPlies ?? 0));
  const done = state.status === "done";
  const live = state.status === "queued" || state.status === "running";
  const facts = opts.comparison ? parseComparisonFacts(opts.comparison.facts) : null;
  return {
    v: 1,
    analysis: {
      status: state.status,
      gradedPlies: graded,
      totalPlies: total,
      failedAtPly: state.failure?.failedAtPly ?? null,
      retryable: state.failure?.retryable ?? false,
      retryAt: state.failure?.retryAt ?? null,
      code: state.failure?.code ?? null,
      etaSec: live
        ? etaSecFor({ position: state.status === "queued" ? Math.max(0, row.queueAhead ?? 0) : 0, totalPlies: total, gradedPlies: graded })
        : null,
    },
    review: {
      ready: done && row.isClean !== null,
      accuracy: done ? round(row.myAccuracy) : null,
      momentsCount: done ? Math.min(MAX_MOMENTS, Math.max(0, row.momentsCount)) : 0,
      isClean: done && row.isClean === true,
      coachLine: done && row.coachLine ? row.coachLine.slice(0, 160) : null,
    },
    comparison:
      opts.comparison && facts ? legendSummaryOf(row.ref, row.startingFen, opts.comparison.status, facts, row.outcome) : null,
    bank: null,
  };
}

// ── /review/[ref]/complete (getReviewComplete, §5.3) and A7's CompleteOut ───────────────────────────────────────
export type CompleteCounts = { moments: number; found: number; revealed: number; reviewed: number };

/** Moment outcomes from the walkthrough progress: found (first try or retry), revealed, any result. */
export function completeCountsOf(content: ReviewContentV1, progress: ReviewProgressV1): CompleteCounts {
  let found = 0;
  let revealed = 0;
  let reviewed = 0;
  for (const m of content.moments) {
    const r = progress.results[String(m.ply)];
    if (!r) continue;
    reviewed += 1;
    if (r === "REVEALED") revealed += 1;
    else found += 1;
  }
  return { moments: content.moments.length, found, revealed, reviewed };
}

export function completeOutOf(input: {
  accuracy: number | null;
  content: ReviewContentV1;
  progress: ReviewProgressV1;
  bestThisMonth: boolean;
  completedAt: Date;
}): CompleteOut {
  const counts = completeCountsOf(input.content, input.progress);
  return {
    accuracy: round(input.accuracy),
    moments: Math.min(MAX_MOMENTS, counts.moments),
    found: counts.found,
    revealed: counts.revealed,
    isClean: input.content.isClean,
    bestThisMonth: input.bestThisMonth,
    completedAt: input.completedAt.toISOString(),
  };
}

/** The viewer's best decision (§8.6 bestPly) as the one standout of a game with no moments, or none. */
function bestMoveStandout(dto: ReviewDTO, replay: Replayed): CompleteStandout[] {
  const ply = dto.review?.bestPly ?? null;
  if (ply === null || ply < 0 || ply >= replay.san.length) return [];
  const label = moveLabel(ply, dto.game.startPly);
  const san = replay.san[ply]!;
  const key = judgementOfChar((dto.analysis?.j ?? "").charAt(ply));
  return [
    {
      ply,
      moveLabel: label,
      fenAfter: replay.fens[ply + 1]!,
      san,
      judgement: key ?? "best",
      caption: (dto.review?.bestDecision ?? `${label}${san} was your best move.`).slice(0, 200),
    },
  ];
}

/** Brilliant, great and mating moves of the viewer's side (the clean-game standouts), ≤ 3, in ply order. */
function standoutsOf(dto: ReviewDTO, replay: Replayed): CompleteStandout[] {
  const j = dto.analysis?.j ?? "";
  const out: CompleteStandout[] = [];
  const startMover = startMoverOf(dto.game.startFen);
  for (let i = 0; i < replay.san.length && out.length < MAX_MOMENTS; i++) {
    if (moverAt(i, startMover) !== dto.you) continue;
    const key = judgementOfChar(j.charAt(i));
    const san = replay.san[i]!;
    const mate = san.endsWith("#");
    if (key !== "brilliant" && key !== "great" && !mate) continue;
    const label = moveLabel(i, dto.game.startPly);
    const caption = mate
      ? `${label}${san} finished the game.`
      : key === "brilliant"
        ? `${label}${san} was a brilliant move.`
        : `${label}${san} was the only good move.`;
    out.push({ ply: i, moveLabel: label, fenAfter: replay.fens[i + 1]!, san, judgement: key ?? "best", caption });
  }
  return out;
}

export function buildCompleteView(
  dto: ReviewDTO,
  opts: { bestThisMonth: boolean; shareEnabled: boolean },
): ReviewCompleteView {
  const replay = replayMoves(dto.game.startFen, dto.moves);
  const review = dto.review;
  const you = dto.players[dto.you];
  const opponent = dto.players[dto.you === "w" ? "b" : "w"];
  const resultLabel = dto.game.endLabel.split(" ")[0] ?? dto.game.result;
  const moments: CompleteMoment[] = (review?.moments ?? []).map((m) => ({
    ply: m.ply,
    moveLabel: m.moveLabel,
    fenAfter: replay.fens[m.ply + 1] ?? replay.fens[replay.fens.length - 1]!,
    playedSan: m.playedSan,
    bestSan: m.bestSan,
    judgement: m.judgement,
    why0: m.why[0]?.t ?? null,
    result: m.result,
  }));
  const found = moments.filter((m) => m.result === "found" || m.result === "found_retry").length;
  const reviewed = moments.filter((m) => m.result !== null).length;
  const brilliant = (dto.analysis?.counts[dto.you] ?? [])[1] ?? 0;
  // noMoments (plan §4.2: DONE, no moments, not clean) shows "Accuracy · Best move": every graded game has a best
  // decision (§8.6 bestPly), so the stat and its card come from it (regression: no-moments-best-move, FIX-2).
  const noMoments = review !== null && !review.isClean && moments.length === 0;
  return {
    v: 1,
    ref: dto.ref,
    header: {
      eyebrow: `Review · vs ${opponent.name} · ${resultLabel}`.slice(0, 160),
      opponentName: opponent.name,
      resultLabel: resultLabel.slice(0, 12),
    },
    accuracy: dto.analysis?.accuracy[dto.you] ?? null,
    moments,
    found,
    reviewed,
    isClean: review?.isClean ?? false,
    bestDecision: review?.bestDecision ?? null,
    brilliant,
    standouts: review?.isClean ? standoutsOf(dto, replay) : noMoments ? bestMoveStandout(dto, replay) : [],
    bestThisMonth: opts.bestThisMonth,
    partial: review?.progress.completedAt == null,
    shareEnabled: opts.shareEnabled && you.isYou,
  };
}
