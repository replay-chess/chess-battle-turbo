// Pure builders for the Phase 3 dev seeds (phase-03 plan §6.9): finished games with what the analysis worker would
// have written for them. No database access here; `seed/writer.ts` turns a `SeedFixture` into rows.
//
// Sources, so no number is invented:
// - The design mocks GAME and CLEAN (`@repo/chess-analysis/fixtures/review-inputs`): their evals, best moves and
//   moment lines, graded by `gradeAnalysis` exactly as the worker grades. Labels are the grader's, not the mock's
//   `q` column (44.Rxf6 is GOOD, not the plan's INACCURACY: see the hand-back; a re-grade would give the same).
// - The 30 Lichess oracle games (`fixtures/oracle`, CC0): real server-analysis evals, Lichess's best moves on judged
//   plies, graded the same way. `evalSource` LICHESS, `nodesPass1/2` 0: they are not our engine's output.
// - The legend fixtures (`fixtures/legend`): the comparison facts every writer computes with `compareWithLegend`.
// - The opening name: the deepest EPD match in the openings table's own source (`apps/web/public/openings/*.tsv`),
//   what the worker writes from `openings.epd`.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gradeAnalysis, gradePlies, type AnalysisInput, type AnalysisResult } from "@repo/chess-analysis/analysis";
import { epdOf, INITIAL_FEN } from "@repo/chess-analysis/board";
import { deepestOpening, parseOpeningsTsv, replayOpening } from "@repo/chess-analysis/book";
import { gradeCodes } from "@repo/chess-analysis/classify";
import { encodeJudgements, encodeMate, moveLabel, type Color } from "@repo/chess-analysis/codec";
import { replayUci, type Replay } from "@repo/chess-analysis/replay";
import type { ReviewContent } from "@repo/chess-analysis/review";
import { analysisEngine, ENGINE_PROFILE, GRADING_VERSION } from "@repo/chess-analysis/version";
import { loadOracleGames, oracleBest, oracleEvals, oracleReplay, type OracleGame } from "@repo/chess-analysis/fixtures/oracle";
import { ANALYSIS_MIN_PLIES, JOB_MAX_ATTEMPTS, JOB_PRIORITY, type JobPriority } from "@repo/contracts/internal/jobs";
import { botDisplayName, startPlyOf, timeClassOf } from "../src/games/derive";
import { buildGameMeta, type GameMetaV1 } from "../src/json/game-meta";
import { buildComparisonFacts, type ComparisonFactsV1 } from "../src/json/legend";
import { buildReviewContent, LinesV1, type ReviewContentV1 } from "../src/json/review";
import { buildShareSnapshot, SHARE_CODE_RE, type ShareSnapshotV1 } from "../src/json/share";
import type {
  GameEndMethod,
  GameMode,
  GameWinner,
  PlayerResult,
  TimeClass,
} from "../src/live/types";

// ── Identities ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Marks every seeded game (`games."gameData"`): the backfills and the seeds' own checks read these keys. */
export const SEED_MARK = "p3Seed";
export const SEED_HASH_KEY = "p3SeedHash";

/** The contracts' ref format (`@repo/contracts/http/common` Ref): `c` + 20…31 of [a-z0-9]. */
export const REF_RE = /^c[a-z0-9]{20,31}$/;

function sha256(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

/**
 * The deterministic `referenceId` of a seeded row: the same (key, scope) gives the same ref on every run and every
 * database, so a re-run finds its own rows and e2e helpers can compute a fixture's URL. 25 characters.
 */
export function seededRef(key: string, scope: string): string {
  return `c${sha256(`p3-seed:${key}:${scope}`).toString("hex").slice(0, 24)}`;
}

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

/** A deterministic share code (8 chars of lowercase Crockford base32 = 40 bits, the A10 format). */
export function seededShareCode(key: string, scope: string): string {
  const bytes = sha256(`p3-share:${key}:${scope}`);
  let bits = 0n;
  for (let i = 0; i < 5; i++) bits = (bits << 8n) | BigInt(bytes[i]!);
  let code = "";
  for (let i = 7; i >= 0; i--) code += CROCKFORD[Number((bits >> BigInt(i * 5)) & 31n)];
  if (!SHARE_CODE_RE.test(code)) throw new Error(`internal: share code ${code} does not match SHARE_CODE_RE`);
  return code;
}

/** Stable JSON (sorted object keys; bigint as decimal string) for content hashes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Date) return v.toISOString();
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

export function contentHash(value: unknown): string {
  return sha256(canonicalJson(value)).toString("hex").slice(0, 32);
}

// ── Row shapes (column names as in schema.prisma) ──────────────────────────────────────────────────────────────

export type AnalysisStatus = "NONE" | "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";
export type LegacyResult = "CREATOR_WON" | "OPPONENT_WON" | "DRAW" | "CREATOR_TIMEOUT" | "OPPONENT_TIMEOUT";

export interface SeedMember {
  id: bigint;
  ref: string;
  name: string;
  /** Displayed rating at the time of the game (game_players."ratingBefore"). */
  rating: number | null;
}

export interface GameRow {
  ref: string;
  mode: GameMode;
  creatorId: bigint;
  opponentId: bigint | null;
  whitePlayerId: bigint | null;
  blackPlayerId: bigint | null;
  botElo: number | null;
  timeClass: TimeClass;
  startingFen: string;
  startPly: number;
  studySeconds: number;
  fen: string;
  moves: string;
  moveClocksMs: number[];
  plyCount: number;
  initialTimeSeconds: number;
  incrementSeconds: number;
  whiteTimeMs: number | null;
  blackTimeMs: number | null;
  endMethod: GameEndMethod;
  outcome: GameWinner;
  result: LegacyResult;
  winnerId: bigint | null;
  pgn: string;
  whiteName: string;
  blackName: string;
  whiteRating: number | null;
  blackRating: number | null;
  chessPositionId: bigint | null;
  meta: GameMetaV1;
  gameData: Record<string, unknown>;
  analysisStatus: AnalysisStatus;
  ecoCode: string | null;
  openingName: string | null;
  createdAt: Date;
  startedAt: Date;
  completedAt: Date;
  expiresAt: Date;
}

export interface PlayerRow {
  userId: bigint;
  color: Color;
  result: PlayerResult;
  opponentUserId: bigint | null;
  opponentName: string;
  opponentRating: number | null;
  ratingBefore: number | null;
  accuracy: number | null;
  headline: string | null;
  momentsCount: number;
  counts: number[];
  phaseAccuracy: number[];
  ecoCode: string | null;
}

export interface AnalysisRow {
  version: number;
  engine: string;
  nodesPass1: number;
  nodesPass2: number;
  evalSource: "ENGINE" | "LICHESS" | "MIXED";
  totalPlies: number;
  gradedPlies: number;
  failedAtPly: number | null;
  evals: number[];
  second: number[];
  best: number[];
  judgements: number[];
  lines: LinesV1 | null;
  middlegamePly: number | null;
  endgamePly: number | null;
  accuracyWhite: number | null;
  accuracyBlack: number | null;
  countsWhite: number[];
  countsBlack: number[];
  completedAt: Date | null;
}

export interface ReviewRow {
  color: Color;
  content: ReviewContentV1;
}

export interface JobRow {
  status: "DONE" | "FAILED";
  priority: JobPriority;
  reason: "live_end" | "bot_end" | "opened" | "backfill";
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: Date;
  startedAt: Date;
  finishedAt: Date;
}

export interface LegendRow {
  userId: bigint;
  status: "FACTS_READY" | "READY";
  facts: ComparisonFactsV1;
}

/** The state a re-run compares with what it finds (mutable columns the app or the worker may change). */
export interface FixtureExpect {
  analysisStatus: AnalysisStatus;
  /** null = no ANALYZE_GAME job may exist; `doneOrPruned` = DONE, or gone (HOUSEKEEPING prunes DONE after 14 d). */
  job: null | "doneOrPruned" | { status: "FAILED"; attempts: number };
  analysis: boolean;
  reviews: number;
  legend: { userId: bigint; status: string }[];
}

export interface SeedFixture {
  key: string;
  game: GameRow;
  players: PlayerRow[];
  analysis: AnalysisRow | null;
  reviews: ReviewRow[];
  job: JobRow | null;
  legend: LegendRow[];
  /** Every member side (their `gamesVersion` is bumped when the fixture is written). */
  members: bigint[];
  expect: FixtureExpect;
  /** Hash of everything above: a changed definition rewrites the fixture. */
  hash: string;
}

// ── Clocks and PGN ─────────────────────────────────────────────────────────────────────────────────────────────

/** Mover's remaining ms after each ply: a deterministic spend pattern plus the increment, never below 1 s. */
export function seedClocks(plies: number, initialMs: number, incMs: number): number[] {
  const left = { w: initialMs, b: initialMs };
  return Array.from({ length: plies }, (_, i) => {
    const side = i % 2 === 0 ? "w" : "b";
    const spend = 2_000 + ((i * 7_919) % Math.max(1, Math.min(23_000, Math.floor(initialMs / 40))));
    left[side] = Math.max(1_000, left[side] - spend + incMs);
    return left[side];
  });
}

function clk(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

const PGN_RESULT: Record<GameWinner, string> = { WHITE: "1-0", BLACK: "0-1", DRAW: "1/2-1/2", NONE: "*" };

/** The P2 PGN shape (headers, SetUp/FEN for a non-initial start, `{[%clk]}` after each move). */
export function seedPgn(o: {
  ref: string;
  event: string;
  white: string;
  black: string;
  startFen: string;
  san: readonly string[];
  clocksMs: readonly number[];
  outcome: GameWinner;
  termination: string;
  timeControl: string;
  date: Date;
}): string {
  const d = o.date;
  const result = PGN_RESULT[o.outcome];
  const headers: [string, string][] = [
    ["Event", o.event],
    ["Site", `https://playchess.tech/game/${o.ref}`],
    ["Date", `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`],
    ["White", o.white],
    ["Black", o.black],
    ["Result", result],
    ["TimeControl", o.timeControl],
    ["Termination", o.termination],
  ];
  if (epdOf(o.startFen) !== epdOf(INITIAL_FEN)) headers.push(["SetUp", "1"], ["FEN", o.startFen]);
  const f = o.startFen.split(" ");
  let moveNo = Number.parseInt(f[5] ?? "1", 10) || 1;
  let black = f[1] === "b";
  const parts: string[] = [];
  o.san.forEach((s, i) => {
    if (!black) parts.push(`${moveNo}.`);
    else if (i === 0) parts.push(`${moveNo}...`);
    parts.push(s);
    if (o.clocksMs[i] != null) parts.push(`{[%clk ${clk(o.clocksMs[i]!)}]}`);
    if (black) moveNo++;
    black = !black;
  });
  parts.push(result);
  return `${headers.map(([k, v]) => `[${k} "${v.replace(/"/g, "'")}"]`).join("\n")}\n\n${parts.join(" ")}\n`;
}

// ── Openings (the worker's deepest-EPD rule over the openings table's source) ─────────────────────────────────

export const OPENINGS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps", "web", "public", "openings");

let openingIndex: Map<string, { eco: string; name: string }> | null = null;

/** Final EPD of every opening line → {eco, name} (built once; lines that do not replay are left out, R12). */
export function openingsByEpd(dir: string = OPENINGS_DIR): Map<string, { eco: string; name: string }> {
  if (openingIndex && dir === OPENINGS_DIR) return openingIndex;
  const map = new Map<string, { eco: string; name: string }>();
  for (const file of ["a.tsv", "b.tsv", "c.tsv", "d.tsv", "e.tsv"]) {
    for (const line of parseOpeningsTsv(readFileSync(path.join(dir, file), "utf8"))) {
      const r = replayOpening(line.pgn);
      if (r.failedAt === null && r.epds.length > 0) map.set(r.epds[r.epds.length - 1]!, { eco: line.eco, name: line.name });
    }
  }
  if (dir === OPENINGS_DIR) openingIndex = map;
  return map;
}

const replayMemo = new Map<string, Replay>();

/** replayUci, memoised (a chess.js replay is the seeds' main cost: the perf seed replays 30 games 2,000 times). */
export function replayCached(startFen: string, moves: readonly string[]): Replay {
  const key = `${startFen}|${moves.join(" ")}`;
  let r = replayMemo.get(key);
  if (!r) {
    r = replayUci(startFen, moves);
    replayMemo.set(key, r);
  }
  return r;
}

/** The opening a game reached: games."ecoCode" (≤ 3) and "openingName" (≤ 80), or nulls. */
export function openingOf(startFen: string, moves: readonly string[]): { eco: string | null; name: string | null } {
  if (epdOf(startFen) !== epdOf(INITIAL_FEN)) return { eco: null, name: null };
  const replay = replayCached(startFen, moves);
  const hit = deepestOpening(replay.epds.slice(1), openingsByEpd());
  return hit ? { eco: hit.eco.slice(0, 3), name: hit.name.slice(0, 80) } : { eco: null, name: null };
}

// ── Analysis rows ──────────────────────────────────────────────────────────────────────────────────────────────

export type EvalProvenance = "design-mock" | "lichess-oracle";

const PROVENANCE: Record<EvalProvenance, { engine: string; evalSource: AnalysisRow["evalSource"]; nodes: boolean }> = {
  "design-mock": { engine: analysisEngine("design-mock"), evalSource: "ENGINE", nodes: true },
  "lichess-oracle": { engine: analysisEngine("lichess-oracle"), evalSource: "LICHESS", nodes: false },
};

/** A complete `game_analyses` row from a graded game (what the worker's final batch writes). */
export function completeAnalysisRow(
  input: AnalysisInput,
  result: AnalysisResult,
  provenance: EvalProvenance,
  completedAt: Date,
): AnalysisRow {
  const p = PROVENANCE[provenance];
  return {
    version: GRADING_VERSION,
    engine: p.engine,
    nodesPass1: p.nodes ? ENGINE_PROFILE.pass1.nodes : 0,
    nodesPass2: p.nodes ? ENGINE_PROFILE.pass2.nodes : 0,
    evalSource: p.evalSource,
    totalPlies: result.totalPlies,
    gradedPlies: result.totalPlies,
    failedAtPly: null,
    evals: [...input.evals],
    second: [...input.second],
    best: [...input.best],
    judgements: [...result.judgements],
    lines: LinesV1.parse(result.lines),
    middlegamePly: result.division.middlegamePly,
    endgamePly: result.division.endgamePly,
    accuracyWhite: result.accuracy.w,
    accuracyBlack: result.accuracy.b,
    countsWhite: [...result.counts.w],
    countsBlack: [...result.counts.b],
    completedAt,
  };
}

/**
 * A partial row of a job that failed for good after `gradedPlies` plies (the terminal-failure fixture): arrays as a
 * checkpoint leaves them (evals gradedPlies + 1, best and judgements gradedPlies), `failedAtPly` set, no totals.
 */
export function partialAnalysisRow(input: AnalysisInput, gradedPlies: number, provenance: EvalProvenance): AnalysisRow {
  const p = PROVENANCE[provenance];
  if (gradedPlies < 1 || gradedPlies >= input.moves.length) throw new RangeError(`gradedPlies ${gradedPlies} out of range`);
  const { grades } = gradePlies(input);
  return {
    version: GRADING_VERSION,
    engine: p.engine,
    nodesPass1: p.nodes ? ENGINE_PROFILE.pass1.nodes : 0,
    nodesPass2: p.nodes ? ENGINE_PROFILE.pass2.nodes : 0,
    evalSource: p.evalSource,
    totalPlies: input.moves.length,
    gradedPlies,
    failedAtPly: gradedPlies,
    evals: input.evals.slice(0, gradedPlies + 1),
    second: input.second.slice(0, gradedPlies + 1),
    best: input.best.slice(0, gradedPlies),
    judgements: gradeCodes(grades).slice(0, gradedPlies),
    lines: null,
    middlegamePly: null,
    endgamePly: null,
    accuracyWhite: null,
    accuracyBlack: null,
    countsWhite: [],
    countsBlack: [],
    completedAt: null,
  };
}

/** The game_players analysis columns of one member side. */
export function playerAnalysisColumns(result: AnalysisResult, side: Color) {
  const review = result.reviews[side];
  if (!review) throw new Error(`internal: no review for side ${side}`);
  return {
    accuracy: result.accuracy[side],
    headline: review.headline,
    momentsCount: review.moments.length,
    counts: [...result.counts[side]],
    phaseAccuracy: [...result.phaseAccuracy[side]],
  };
}

/** The review document of one member side, validated as the worker validates it. */
export function reviewContentOf(result: AnalysisResult, side: Color): ReviewContentV1 {
  const review: ReviewContent | undefined = result.reviews[side];
  if (!review) throw new Error(`internal: no review for side ${side}`);
  return buildReviewContent(review);
}

// ── Oracle games (real evals) ──────────────────────────────────────────────────────────────────────────────────

let oracleCache: OracleGame[] | null = null;

export function oracleGames(): OracleGame[] {
  oracleCache ??= loadOracleGames();
  return oracleCache;
}

/**
 * The grading input of oracle game `index`. Lichess publishes no eval for a final checkmate position; the worker
 * stores the terminal mate there (`encodeMate(winner, 0)`), so the seed does the same.
 */
const oracleMemo = new Map<number, { game: OracleGame; input: AnalysisInput }>();

export function oracleInput(index: number, members: AnalysisInput["members"]): { game: OracleGame; input: AnalysisInput } {
  const games = oracleGames();
  const k = index % games.length;
  let hit = oracleMemo.get(k);
  if (!hit) {
    hit = oracleInputUncached(games[k]!);
    oracleMemo.set(k, hit);
  }
  return { game: hit.game, input: { ...hit.input, members: [...members] } };
}

function oracleInputUncached(game: OracleGame): { game: OracleGame; input: AnalysisInput } {
  const replay = oracleReplay(game);
  const evals = oracleEvals(game);
  if (evals.length === replay.uci.length) {
    if (!replay.final.checkmate) throw new Error(`oracle ${game.id}: an eval is missing and the game is not mate`);
    const mover: Color = replay.uci.length % 2 === 1 ? "w" : "b";
    evals.push(encodeMate(mover, 0));
  }
  if (evals.length !== replay.uci.length + 1) throw new Error(`oracle ${game.id}: ${evals.length} evals for ${replay.uci.length} plies`);
  return {
    game,
    input: { startFen: replay.startFen, startPly: 0, moves: replay.uci, evals, second: [], best: oracleBest(game, replay), members: [] },
  };
}

/** The end of an oracle game as P2 records it. */
export function oracleEnding(game: OracleGame): { outcome: GameWinner; method: GameEndMethod } {
  const outcome: GameWinner = game.winner === "white" ? "WHITE" : game.winner === "black" ? "BLACK" : "DRAW";
  const method: Record<string, GameEndMethod> = {
    resign: "RESIGNATION",
    mate: "CHECKMATE",
    outoftime: outcome === "DRAW" ? "TIMEOUT_VS_INSUFFICIENT" : "TIMEOUT",
    draw: "AGREEMENT",
    stalemate: "STALEMATE",
    insufficientMaterialClaim: "INSUFFICIENT_MATERIAL",
  };
  return { outcome, method: method[game.status] ?? "OTHER" };
}

// ── Game assembly ──────────────────────────────────────────────────────────────────────────────────────────────

export interface TimeControl {
  initialSeconds: number;
  incrementSeconds: number;
}

export interface OpponentSpec {
  kind: "member" | "bot";
  /** Member opponents only. */
  member?: SeedMember;
  /** Bot opponents only: the ladder Elo ("Engine 1200"). */
  elo?: number;
}

export interface GameSpec {
  key: string;
  /** Scope of the deterministic ref (the member's users.referenceId, or a fixed name for shared fixtures). */
  scope: string;
  member: SeedMember;
  memberColor: Color;
  opponent: OpponentSpec;
  /** The legacy bot user (CHESS_BOT_001): games."opponentId" of a bot game, as P2's creator writes it. */
  botUserId?: bigint | null;
  mode: GameMode;
  startFen: string;
  moves: readonly string[];
  /** null = untimed (bot games only). */
  tc: TimeControl | null;
  outcome: GameWinner;
  method: GameEndMethod;
  completedAt: Date;
  /** `analysisStatus` and what goes with it. */
  analysis:
    | { kind: "none" }
    /** Under ANALYSIS_MIN_PLIES (or aborted): SKIPPED, never enqueued. */
    | { kind: "skipped" }
    | { kind: "done"; input: AnalysisInput; provenance: EvalProvenance; reason: JobRow["reason"]; priority: JobPriority }
    | { kind: "terminal"; input: AnalysisInput; provenance: EvalProvenance; gradedPlies: number; lastError: string };
  chessPositionId?: bigint | null;
  position?: { name: string; event: string | null; year: number | null; legendSide: Color; moveNumber: number } | null;
  legend?: { status: LegendRow["status"]; facts: ComparisonFactsV1 } | null;
  /** Extra `gameData` keys (the seed mark is always added). */
  tag: string;
}

function playerResult(outcome: GameWinner, color: Color): PlayerResult {
  if (outcome === "DRAW") return "DRAW";
  return (outcome === "WHITE") === (color === "w") ? "WIN" : "LOSS";
}

function legacyResult(outcome: GameWinner, method: GameEndMethod, winnerIsCreator: boolean): LegacyResult {
  if (outcome === "DRAW") return "DRAW";
  const timeout = method === "TIMEOUT";
  if (winnerIsCreator) return timeout ? "OPPONENT_TIMEOUT" : "CREATOR_WON";
  return timeout ? "CREATOR_TIMEOUT" : "OPPONENT_WON";
}

const TERMINATION: Partial<Record<GameEndMethod, string>> = { TIMEOUT: "Time forfeit", ABANDONED: "Abandoned" };

function tcLabel(tc: TimeControl | null): string {
  return tc ? `${tc.initialSeconds}+${tc.incrementSeconds}` : "-";
}

const gradeMemo = new Map<string, AnalysisResult>();

/** gradeAnalysis, memoised by input (the perf seed grades the same 30 oracle games ~1,300 times). Pure, so safe. */
function gradeCached(input: AnalysisInput): AnalysisResult {
  // A book-set function is not serialisable, so such an input is never memoised.
  if (input.isBook) return gradeAnalysis(input);
  const key = contentHash(input);
  let r = gradeMemo.get(key);
  if (!r) {
    r = gradeAnalysis(input);
    gradeMemo.set(key, r);
  }
  return r;
}

/** Builds one finished game and everything the worker would have written for it. */
export function buildFixture(spec: GameSpec): SeedFixture {
  const ref = seededRef(spec.key, spec.scope);
  const replay = replayCached(spec.startFen, spec.moves);
  const plies = replay.uci.length;
  const isBot = spec.mode === "BOT" || spec.mode === "LEGEND_BOT";
  if (isBot !== (spec.opponent.kind === "bot")) throw new Error(`${spec.key}: mode ${spec.mode} and opponent ${spec.opponent.kind} disagree`);
  if (!spec.tc && !isBot) throw new Error(`${spec.key}: only bot games are untimed`);
  const opp = spec.opponent;
  const oppName = opp.kind === "bot" ? botDisplayName(opp.elo!) : opp.member!.name;
  const oppRating = opp.kind === "bot" ? opp.elo! : opp.member!.rating;
  const oppUserId = opp.kind === "member" ? opp.member!.id : null;
  const memberIsWhite = spec.memberColor === "w";
  const whiteId = memberIsWhite ? spec.member.id : oppUserId;
  const blackId = memberIsWhite ? oppUserId : spec.member.id;

  const clocks = spec.tc ? seedClocks(plies, spec.tc.initialSeconds * 1000, spec.tc.incrementSeconds * 1000) : [];
  const lastOf = (c: Color) => {
    const startMover = replay.startMover;
    for (let i = plies - 1; i >= 0; i--) if ((i % 2 === 0 ? startMover : startMover === "w" ? "b" : "w") === c) return clocks[i] ?? null;
    return spec.tc ? spec.tc.initialSeconds * 1000 : null;
  };
  let whiteTimeMs = spec.tc ? lastOf("w") : null;
  let blackTimeMs = spec.tc ? lastOf("b") : null;
  if (spec.method === "TIMEOUT" && spec.tc) {
    // The side that lost on time shows 0.
    if (spec.outcome === "WHITE") blackTimeMs = 0;
    if (spec.outcome === "BLACK") whiteTimeMs = 0;
  }

  const opening = openingOf(spec.startFen, replay.uci);
  const whiteName = memberIsWhite ? spec.member.name : oppName;
  const blackName = memberIsWhite ? oppName : spec.member.name;
  const timeClass: TimeClass = timeClassOf(spec.tc ? { initialSeconds: spec.tc.initialSeconds, incrementSeconds: spec.tc.incrementSeconds } : null);
  const startedAt = new Date(spec.completedAt.getTime() - Math.max(60_000, plies * 9_000));
  const winnerId = spec.outcome === "WHITE" ? whiteId : spec.outcome === "BLACK" ? blackId : null;
  // P2 writes a header only for games from a position; the opening of a game from the initial position is the
  // worker's to find (final batch), so an unanalysed game has none.
  const header = spec.position ? spec.position.name.slice(0, 80) : "";
  const meta = buildGameMeta({
    v: 1,
    header,
    prefixSan: [],
    prefixStartMoveNo: spec.position?.moveNumber ?? 1,
    position: spec.position
      ? { name: spec.position.name, event: spec.position.event, year: spec.position.year, afterLabel: null, legendSide: spec.position.legendSide }
      : null,
  });

  const sides: { userId: bigint; color: Color; oppUserId: bigint | null; oppName: string; oppRating: number | null; rating: number | null }[] = [
    { userId: spec.member.id, color: spec.memberColor, oppUserId, oppName, oppRating, rating: spec.member.rating },
  ];
  if (opp.kind === "member") {
    sides.push({
      userId: opp.member!.id,
      color: memberIsWhite ? "b" : "w",
      oppUserId: spec.member.id,
      oppName: spec.member.name,
      oppRating: spec.member.rating,
      rating: opp.member!.rating,
    });
  }
  if (spec.analysis.kind === "skipped" && plies >= ANALYSIS_MIN_PLIES) {
    throw new Error(`${spec.key}: only a game under ${ANALYSIS_MIN_PLIES} plies is SKIPPED`);
  }
  if (spec.analysis.kind === "done" || spec.analysis.kind === "terminal") {
    const graded = spec.analysis.input.members.map((m) => m.side).sort();
    const expected = sides.map((s) => s.color).sort();
    if (canonicalJson(graded) !== canonicalJson(expected)) {
      throw new Error(`${spec.key}: grade every member side (${expected.join(",")}), not ${graded.join(",")}`);
    }
  }

  // Analysis rows.
  let analysis: AnalysisRow | null = null;
  let graded: AnalysisResult | null = null;
  let job: JobRow | null = null;
  let analysisStatus: AnalysisStatus = "NONE";
  const doneAt = new Date(spec.completedAt.getTime() + 25_000);
  if (spec.analysis.kind === "done") {
    const a = spec.analysis;
    if (a.input.moves.length !== plies || a.input.moves.some((m, i) => m !== replay.uci[i])) {
      throw new Error(`${spec.key}: the analysis input's moves are not the game's moves`);
    }
    graded = gradeCached(a.input);
    analysis = completeAnalysisRow(a.input, graded, a.provenance, doneAt);
    analysisStatus = "DONE";
    job = {
      status: "DONE",
      priority: a.priority,
      reason: a.reason,
      attempts: 1,
      maxAttempts: JOB_MAX_ATTEMPTS.ANALYZE_GAME,
      lastError: null,
      createdAt: spec.completedAt,
      startedAt: new Date(spec.completedAt.getTime() + 1_000),
      finishedAt: doneAt,
    };
  } else if (spec.analysis.kind === "skipped") {
    analysisStatus = "SKIPPED";
  } else if (spec.analysis.kind === "terminal") {
    const a = spec.analysis;
    analysis = partialAnalysisRow(a.input, a.gradedPlies, a.provenance);
    analysisStatus = "FAILED";
    job = {
      status: "FAILED",
      priority: JOB_PRIORITY.GAME_ENDED,
      reason: isBot ? "bot_end" : "live_end",
      attempts: JOB_MAX_ATTEMPTS.ANALYZE_GAME,
      maxAttempts: JOB_MAX_ATTEMPTS.ANALYZE_GAME,
      lastError: a.lastError.slice(0, 1000),
      createdAt: spec.completedAt,
      startedAt: new Date(spec.completedAt.getTime() + 1_000),
      finishedAt: new Date(spec.completedAt.getTime() + 13 * 60_000),
    };
  }

  const players: PlayerRow[] = sides.map((s) => {
    const cols = graded ? playerAnalysisColumns(graded, s.color) : null;
    return {
      userId: s.userId,
      color: s.color,
      result: playerResult(spec.outcome, s.color),
      opponentUserId: s.oppUserId,
      opponentName: s.oppName.slice(0, 40),
      opponentRating: s.oppRating,
      ratingBefore: s.rating,
      accuracy: cols?.accuracy ?? null,
      headline: cols?.headline ?? null,
      momentsCount: cols?.momentsCount ?? 0,
      counts: cols?.counts ?? [],
      phaseAccuracy: cols?.phaseAccuracy ?? [],
      ecoCode: graded ? opening.eco : null,
    };
  });
  const reviews: ReviewRow[] = graded ? sides.map((s) => ({ color: s.color, content: reviewContentOf(graded!, s.color) })) : [];

  const legend: LegendRow[] = spec.legend
    ? [{ userId: spec.member.id, status: spec.legend.status, facts: buildComparisonFacts(spec.legend.facts) }]
    : [];

  const game: GameRow = {
    ref,
    mode: spec.mode,
    creatorId: spec.member.id,
    opponentId: oppUserId ?? (isBot ? (spec.botUserId ?? null) : null),
    whitePlayerId: whiteId,
    blackPlayerId: blackId,
    botElo: opp.kind === "bot" ? opp.elo! : null,
    timeClass,
    startingFen: spec.startFen,
    startPly: startPlyOf(spec.startFen),
    studySeconds: spec.position ? 30 : 0,
    fen: replay.fens[plies]!,
    moves: replay.uci.join(" "),
    moveClocksMs: clocks,
    plyCount: plies,
    initialTimeSeconds: spec.tc?.initialSeconds ?? 0,
    incrementSeconds: spec.tc?.incrementSeconds ?? 0,
    whiteTimeMs,
    blackTimeMs,
    endMethod: spec.method,
    outcome: spec.outcome,
    result: legacyResult(spec.outcome, spec.method, winnerId === spec.member.id),
    winnerId,
    pgn: seedPgn({
      ref,
      event: isBot ? "Replay Chess · Bot game" : spec.mode === "ONLINE" ? "Replay Chess · Online game" : "Replay Chess · Friend game",
      white: whiteName,
      black: blackName,
      startFen: spec.startFen,
      san: replay.san,
      clocksMs: clocks,
      outcome: spec.outcome,
      termination: TERMINATION[spec.method] ?? "Normal",
      timeControl: tcLabel(spec.tc),
      date: spec.completedAt,
    }),
    whiteName,
    blackName,
    whiteRating: memberIsWhite ? spec.member.rating : oppRating,
    blackRating: memberIsWhite ? oppRating : spec.member.rating,
    chessPositionId: spec.chessPositionId ?? null,
    meta,
    gameData: { [SEED_MARK]: spec.tag, fixture: spec.key, gameMode: isBot ? "AI" : "friend" },
    analysisStatus,
    ecoCode: graded ? opening.eco : null,
    openingName: graded ? opening.name : null,
    createdAt: startedAt,
    startedAt,
    completedAt: spec.completedAt,
    expiresAt: new Date(startedAt.getTime() + 24 * 3_600_000),
  };

  const members = sides.map((s) => s.userId);
  const expect: FixtureExpect = {
    analysisStatus,
    job: job ? (job.status === "DONE" ? "doneOrPruned" : { status: "FAILED", attempts: job.attempts }) : null,
    analysis: analysis !== null,
    reviews: reviews.length,
    legend: legend.map((l) => ({ userId: l.userId, status: l.status })),
  };
  const hash = contentHash({ game, players, analysis, reviews, job, legend });
  game.gameData = { ...game.gameData, [SEED_HASH_KEY]: hash };
  return { key: spec.key, game, players, analysis, reviews, job, legend, members, expect, hash };
}

// ── Shares (expired / revoked / live; times are relative to `now`, so they are not in the fixture hash) ───────

export interface ShareRow {
  code: string;
  gameRef: string;
  ownerId: bigint;
  color: Color;
  ply: number | null;
  showUsername: boolean;
  snapshot: ShareSnapshotV1;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** HOUSEKEEPING prunes REVIEW shares 7 days after they expire (plan 7.7); an expired seed share stays inside that. */
export const SHARE_PRUNE_AFTER_MS = 7 * 24 * 3_600_000;
export const SHARE_TTL_MS = 30 * 24 * 3_600_000;

const RESULT_LABEL: Record<GameWinner, string> = { WHITE: "1-0", BLACK: "0-1", DRAW: "½-½", NONE: "*" };
const RESULT_DASH: Record<GameWinner, string> = { WHITE: "1–0", BLACK: "0–1", DRAW: "½–½", NONE: "–" };
const METHOD_WORD: Partial<Record<GameEndMethod, string>> = {
  CHECKMATE: "checkmate",
  RESIGNATION: "resigned",
  TIMEOUT: "on time",
  STALEMATE: "stalemate",
  THREEFOLD: "repetition",
  AGREEMENT: "agreed",
  INSUFFICIENT_MATERIAL: "insufficient material",
  FIFTY_MOVE: "50-move rule",
};
const TC_WORD: Record<TimeClass, string> = {
  BULLET: "Bullet",
  BLITZ: "Blitz",
  RAPID: "Rapid",
  CLASSICAL: "Classical",
  DAILY: "Daily",
  UNTIMED: "Untimed",
};

/**
 * The frozen public snapshot of a review share (plan 6.6 ShareSnapshotV1, 11.3 masking): the sharer's name only
 * with showUsername, a member opponent as "Opponent (rating)", a bot by its ladder name. No refs, no clocks.
 */
export function shareSnapshotOf(fixture: SeedFixture, ownerColor: Color, showUsername: boolean): ShareSnapshotV1 {
  const g = fixture.game;
  const a = fixture.analysis;
  const review = fixture.reviews.find((r) => r.color === ownerColor)?.content;
  if (!a || !review || g.analysisStatus !== "DONE") throw new Error(`${fixture.key}: only an analysed game can be shared`);
  const replay = replayUci(g.startingFen, g.moves === "" ? [] : g.moves.split(" "));
  const oppColor: Color = ownerColor === "w" ? "b" : "w";
  const oppIsMember = fixture.players.some((p) => p.color === oppColor);
  const nameOf = (c: Color) => (c === "w" ? g.whiteName : g.blackName);
  const ratingOf = (c: Color) => (c === "w" ? g.whiteRating : g.blackRating);
  const masked = (c: Color) => {
    if (c === ownerColor) return showUsername ? nameOf(c) : "A Replay Chess player";
    if (!oppIsMember) return nameOf(c);
    const r = ratingOf(c);
    return r === null ? "Opponent" : `Opponent (${r})`;
  };
  const worst = [...review.moments].sort((x, y) => y.judgement - x.judgement || x.ply - y.ply)[0] ?? null;
  const acc = (v: number | null) => (v === null ? null : Math.round(v));
  const tc = g.timeClass === "UNTIMED" ? "Untimed" : `${TC_WORD[g.timeClass]} ${g.initialTimeSeconds / 60}+${g.incrementSeconds}`;
  return buildShareSnapshot({
    v: 1,
    kind: "review",
    players: {
      w: { name: masked("w").slice(0, 40), rating: ratingOf("w"), isYou: ownerColor === "w" },
      b: { name: masked("b").slice(0, 40), rating: ratingOf("b"), isYou: ownerColor === "b" },
    },
    result: RESULT_LABEL[g.outcome],
    endLabel: `${RESULT_DASH[g.outcome]} ${METHOD_WORD[g.endMethod] ?? "game over"}`.slice(0, 40),
    tcLabel: tc.slice(0, 24),
    playedOn: g.completedAt.toISOString().slice(0, 10),
    startFen: g.startingFen,
    moves: g.moves,
    san: replay.san.join(" "),
    j: encodeJudgements(a.judgements),
    evals: a.evals,
    accuracy: {
      you: acc(ownerColor === "w" ? a.accuracyWhite : a.accuracyBlack),
      opp: acc(ownerColor === "w" ? a.accuracyBlack : a.accuracyWhite),
    },
    moment: worst
      ? {
          ply: worst.ply,
          playedSan: replay.san[worst.ply]!,
          bestSan: sanAt(replay.fens[worst.ply]!, worst.bestUci),
          judgement: worst.judgement,
          caption: `${moveLabel(worst.ply, g.startPly)}${replay.san[worst.ply]}: ${(worst.why[0]?.t ?? worst.ask)}`.slice(0, 200),
          arrow: [worst.bestUci.slice(0, 2), worst.bestUci.slice(2, 4)],
        }
      : null,
    summary: review.summary.map((s) => s.t.slice(0, 400)),
    gradingVersion: a.version,
  });
}

function sanAt(fen: string, uci: string): string {
  return replayUci(fen, [uci]).san[0]!;
}

/** The expired and the revoked share of a fixture (plan 6.9: `/r/[code]` `gone`), relative to `now`. */
export function goneShares(fixture: SeedFixture, ownerColor: Color, scope: string, now: Date): ShareRow[] {
  const owner = fixture.players.find((p) => p.color === ownerColor);
  if (!owner) throw new Error(`${fixture.key}: no member on ${ownerColor}`);
  const snapshot = shareSnapshotOf(fixture, ownerColor, true);
  const t = now.getTime();
  const firstMoment = fixture.reviews.find((r) => r.color === ownerColor)?.content.moments[0]?.ply ?? null;
  return [
    {
      code: seededShareCode(`${fixture.key}:expired`, scope),
      gameRef: fixture.game.ref,
      ownerId: owner.userId,
      color: ownerColor,
      ply: firstMoment,
      showUsername: true,
      snapshot,
      createdAt: new Date(t - SHARE_TTL_MS - 24 * 3_600_000),
      expiresAt: new Date(t - 24 * 3_600_000),
      revokedAt: null,
    },
    {
      code: seededShareCode(`${fixture.key}:revoked`, scope),
      gameRef: fixture.game.ref,
      ownerId: owner.userId,
      color: ownerColor,
      ply: firstMoment,
      showUsername: true,
      snapshot,
      createdAt: new Date(t - 2 * 24 * 3_600_000),
      expiresAt: new Date(t - 2 * 24 * 3_600_000 + SHARE_TTL_MS),
      revokedAt: new Date(t - 3_600_000),
    },
  ];
}

/**
 * The live share of a fixture (plan 6.9, §12.3: the layout suite and the public-page specs open `/r/<seeded code>`):
 * created an hour before `now`, so it expires in 30 days minus an hour. Its code is fixed per member.
 */
export function liveShare(fixture: SeedFixture, ownerColor: Color, scope: string, now: Date): ShareRow {
  const owner = fixture.players.find((p) => p.color === ownerColor);
  if (!owner) throw new Error(`${fixture.key}: no member on ${ownerColor}`);
  const t = now.getTime();
  return {
    code: seededShareCode(`${fixture.key}:live`, scope),
    gameRef: fixture.game.ref,
    ownerId: owner.userId,
    color: ownerColor,
    ply: fixture.reviews.find((r) => r.color === ownerColor)?.content.moments[0]?.ply ?? null,
    showUsername: true,
    snapshot: shareSnapshotOf(fixture, ownerColor, true),
    createdAt: new Date(t - 3_600_000),
    expiresAt: new Date(t - 3_600_000 + SHARE_TTL_MS),
    revokedAt: null,
  };
}

/** A live seed share is re-dated when it has less than this left (a week), so it never expires under a test. */
export const LIVE_SHARE_MIN_LEFT_MS = 7 * 24 * 3_600_000;

export type SeedShareKind = "expired" | "revoked" | "live";

/** Is a stored share still in the state its seed row describes (live with a week left / expired, not pruned / revoked)? */
export function shareInSeededState(
  kind: SeedShareKind,
  stored: { expiresAt: Date | null; revokedAt: Date | null } | undefined,
  now: Date,
): boolean {
  if (kind !== "live") return shareStillGone(kind, stored, now);
  if (!stored || stored.revokedAt !== null || stored.expiresAt === null) return false;
  return stored.expiresAt.getTime() - now.getTime() >= LIVE_SHARE_MIN_LEFT_MS;
}

/** Is a stored share still in the state its seed row describes (expired but not yet pruned / revoked)? */
export function shareStillGone(
  kind: "expired" | "revoked",
  stored: { expiresAt: Date | null; revokedAt: Date | null } | undefined,
  now: Date,
): boolean {
  if (!stored) return false;
  if (kind === "revoked") return stored.revokedAt !== null;
  const exp = stored.expiresAt?.getTime();
  if (exp === undefined || stored.revokedAt !== null) return false;
  // Expired, and at least a day away from the HOUSEKEEPING prune.
  return exp <= now.getTime() && exp > now.getTime() - SHARE_PRUNE_AFTER_MS + 24 * 3_600_000;
}
