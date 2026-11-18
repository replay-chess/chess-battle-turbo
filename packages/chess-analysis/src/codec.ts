// Storage and wire encodings of the grading data (phase-03 plan §8.1, §8.16, §6.1, §5.2).
//
// Everything a game analysis stores per position or per ply is a small integer, so `game_analyses` keeps one
// smallint[] per field (DM convention 5) and the review payload stays near 4 KB:
//
// | Item                | Encoding                                                                             |
// |---------------------|--------------------------------------------------------------------------------------|
// | JudgementCode (DB)  | 0 ungraded, 1 BRILLIANT … 12 BLUNDER (append-only; the order of JUDGEMENT_KEYS)      |
// | `j` char (DTO)      | one char per ply, `JUDGEMENT_CHARS[code]` (`.` ungraded)                              |
// | MoveCode (DB)       | from + 64·to + 4096·promo (squares a1 = 0 … h8 = 63; promo 0 none, 1 n, 2 b, 3 r, 4 q)|
// |                     | 0 = unknown (a1a1 is not a move, so 0 never collides with a real move)               |
// | `best` (DTO)        | UCI tokens separated by single spaces, `-` for unknown                               |
// | eval (DB and DTO)   | White POV. |e| < 29000: centipawns clamped to ±9999. Otherwise e = sign·(30000 − n):  |
// |                     | the sign's side mates in n moves; n = 0: the side to move is checkmated (terminal).  |
// |                     | Stalemate and every other terminal draw store 0.                                     |
// | `second`            | the MultiPV-2 score of the position in the same encoding; 32767 = no second move      |
//
// Mate distance n counts moves, as UCI `score mate` does (Stockfish: "mate in y moves, not plies"), so it is the
// number the engine printed, re-signed to White's point of view.
//
// No I/O; pure functions only.

export type Color = "w" | "b";

/* ------------------------------------------------------------------------------------------------------------ */
/* Judgements                                                                                                   */
/* ------------------------------------------------------------------------------------------------------------ */

/** Wire keys (`JKey` in the review contract), in JudgementCode order: code = index + 1. Append-only. */
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
export type JudgementKey = (typeof JUDGEMENT_KEYS)[number];

/** JudgementCode values (§6.1). 0 = not graded yet. Append-only: a stored code never changes meaning. */
export const J = {
  UNGRADED: 0,
  BRILLIANT: 1,
  GREAT: 2,
  BEST: 3,
  EXCELLENT: 4,
  GOOD: 5,
  BOOK: 6,
  FORCED: 7,
  INTERESTING: 8,
  INACCURACY: 9,
  MISTAKE: 10,
  MISS: 11,
  BLUNDER: 12,
} as const;
export type JudgementCode = (typeof J)[keyof typeof J];

/** Number of judgement counters per side (index = JudgementCode; [0] unused). */
export const JUDGEMENT_COUNT_SLOTS = 13;

/** `j` chars, index = JudgementCode. */
export const JUDGEMENT_CHARS = ".BGbEgkFNIMSX";

/** The Postgres/Prisma `Judgement` enum names, index = JudgementCode (index 0 has no enum value). */
export const JUDGEMENT_ENUM = [
  null,
  "BRILLIANT",
  "GREAT",
  "BEST",
  "EXCELLENT",
  "GOOD",
  "BOOK",
  "FORCED",
  "INTERESTING",
  "INACCURACY",
  "MISTAKE",
  "MISS",
  "BLUNDER",
] as const;
export type JudgementEnum = Exclude<(typeof JUDGEMENT_ENUM)[number], null>;

export function isJudgementCode(n: number): n is JudgementCode {
  return Number.isInteger(n) && n >= 0 && n <= J.BLUNDER;
}

function assertCode(code: number): asserts code is JudgementCode {
  if (!isJudgementCode(code)) throw new RangeError(`invalid JudgementCode ${code}`);
}

export function judgementChar(code: number): string {
  assertCode(code);
  return JUDGEMENT_CHARS[code] as string;
}

export function judgementFromChar(ch: string): JudgementCode {
  const code = ch.length === 1 ? JUDGEMENT_CHARS.indexOf(ch) : -1;
  if (code < 0) throw new RangeError(`invalid judgement char ${JSON.stringify(ch)}`);
  return code as JudgementCode;
}

/** Wire key of a graded code; `null` for 0 (ungraded). */
export function judgementKey(code: number): JudgementKey | null {
  assertCode(code);
  return code === 0 ? null : (JUDGEMENT_KEYS[code - 1] as JudgementKey);
}

export function judgementFromKey(key: JudgementKey): JudgementCode {
  const i = JUDGEMENT_KEYS.indexOf(key);
  if (i < 0) throw new RangeError(`invalid judgement key ${JSON.stringify(key)}`);
  return (i + 1) as JudgementCode;
}

export function judgementEnum(code: number): JudgementEnum | null {
  assertCode(code);
  return JUDGEMENT_ENUM[code] ?? null;
}

/** smallint[] → the DTO's `j` string (one char per ply). */
export function encodeJudgements(codes: readonly number[]): string {
  let s = "";
  for (const c of codes) s += judgementChar(c);
  return s;
}

/** The DTO's `j` string → smallint[]. */
export function decodeJudgements(j: string): JudgementCode[] {
  const out: JudgementCode[] = [];
  for (const ch of j) out.push(judgementFromChar(ch));
  return out;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Moves                                                                                                        */
/* ------------------------------------------------------------------------------------------------------------ */

const FILES = "abcdefgh";
const PROMOS = ["", "n", "b", "r", "q"] as const;
/** Largest valid MoveCode: h8 → g8 with a queen promotion stays well inside smallint. */
export const MOVE_CODE_MAX = 63 + 64 * 63 + 4096 * 4;
export const MOVE_UNKNOWN = 0;
const UCI_RE = /^([a-h][1-8])([a-h][1-8])([nbrq])?$/;

/** "e4" → 28 (a1 = 0, h1 = 7, a2 = 8 … h8 = 63). */
export function squareIndex(sq: string): number {
  const file = FILES.indexOf(sq[0] ?? "");
  const rank = Number(sq[1]) - 1;
  if (sq.length !== 2 || file < 0 || !(rank >= 0 && rank <= 7)) throw new RangeError(`invalid square ${sq}`);
  return file + 8 * rank;
}

export function squareName(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > 63) throw new RangeError(`invalid square index ${index}`);
  return `${FILES[index % 8]}${Math.floor(index / 8) + 1}`;
}

export function isUci(s: string): boolean {
  const m = UCI_RE.exec(s);
  return m !== null && m[1] !== m[2];
}

/** UCI ("e7e8q") → MoveCode. Throws on a malformed move. */
export function encodeMove(uci: string): number {
  const m = UCI_RE.exec(uci);
  if (!m || m[1] === m[2]) throw new RangeError(`invalid UCI move ${JSON.stringify(uci)}`);
  const promo = m[3] ? PROMOS.indexOf(m[3] as (typeof PROMOS)[number]) : 0;
  return squareIndex(m[1] as string) + 64 * squareIndex(m[2] as string) + 4096 * promo;
}

/** MoveCode → UCI; `null` for 0 (unknown). Throws on a code no move encodes to. */
export function decodeMove(code: number): string | null {
  if (code === MOVE_UNKNOWN) return null;
  if (!Number.isInteger(code) || code < 0 || code > MOVE_CODE_MAX) throw new RangeError(`invalid MoveCode ${code}`);
  const from = code % 64;
  const to = Math.floor(code / 64) % 64;
  const promo = Math.floor(code / 4096);
  if (from === to) throw new RangeError(`invalid MoveCode ${code}`);
  return `${squareName(from)}${squareName(to)}${PROMOS[promo]}`;
}

/** smallint[] of MoveCodes → the DTO's `best` string ("e2e4 g8f6 - …"). */
export function encodeBestTokens(codes: readonly number[]): string {
  return codes.map((c) => decodeMove(c) ?? "-").join(" ");
}

/** The DTO's `best` string → UCI per ply (`null` where unknown). An empty string is an empty list. */
export function decodeBestTokens(best: string): (string | null)[] {
  if (best === "") return [];
  return best.split(" ").map((t) => {
    if (t === "-") return null;
    if (!isUci(t)) throw new RangeError(`invalid best token ${JSON.stringify(t)}`);
    return t;
  });
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Evals                                                                                                        */
/* ------------------------------------------------------------------------------------------------------------ */

export const MATE_BASE = 30000;
/** |e| at or above this is a mate score. */
export const MATE_THRESHOLD = 29000;
/** Largest mate distance the encoding holds (e = ±29000). */
export const MATE_MAX_MOVES = MATE_BASE - MATE_THRESHOLD;
/** Centipawn clamp for storage. */
export const CP_STORE_LIMIT = 9999;
/** `second[i]` when the position has no second legal move. */
export const NO_SECOND = 32767;

export type DecodedEval =
  | { kind: "cp"; cp: number }
  /** `winner` mates in `moves` moves; `moves = 0`: the loser, who is to move, is already checkmated. */
  | { kind: "mate"; winner: Color; moves: number };

/** Centipawns (White POV) → stored eval: rounded, clamped to ±9999. */
export function encodeCp(cp: number): number {
  if (!Number.isFinite(cp)) throw new RangeError(`invalid centipawns ${cp}`);
  const r = Math.round(cp);
  return Math.max(-CP_STORE_LIMIT, Math.min(CP_STORE_LIMIT, r === 0 ? 0 : r));
}

/** A mate for `winner` in `moves` moves → stored eval. */
export function encodeMate(winner: Color, moves: number): number {
  if (!Number.isInteger(moves) || moves < 0 || moves > MATE_MAX_MOVES) throw new RangeError(`invalid mate ${moves}`);
  return (winner === "w" ? 1 : -1) * (MATE_BASE - moves);
}

export function encodeEval(e: DecodedEval): number {
  return e.kind === "cp" ? encodeCp(e.cp) : encodeMate(e.winner, e.moves);
}

export function isValidEval(e: number): boolean {
  return (
    Number.isInteger(e) &&
    (Math.abs(e) <= CP_STORE_LIMIT || (Math.abs(e) >= MATE_THRESHOLD && Math.abs(e) <= MATE_BASE))
  );
}

function assertEval(e: number): void {
  if (!isValidEval(e)) throw new RangeError(`invalid stored eval ${e}`);
}

export function decodeEval(e: number): DecodedEval {
  assertEval(e);
  if (Math.abs(e) < MATE_THRESHOLD) return { kind: "cp", cp: e === 0 ? 0 : e };
  return { kind: "mate", winner: e > 0 ? "w" : "b", moves: MATE_BASE - Math.abs(e) };
}

/** True for a mate score (either side). The `second` sentinel is not an eval: check `hasSecond` first. */
export function isMateEval(e: number): boolean {
  return Math.abs(e) >= MATE_THRESHOLD && e !== NO_SECOND;
}

/** Mate distance in moves of a mate score, or `null` for a centipawn score. */
export function mateMoves(e: number): number | null {
  return isMateEval(e) ? MATE_BASE - Math.abs(e) : null;
}

export function hasSecond(s: number): boolean {
  return s !== NO_SECOND;
}

/** A stored eval from the point of view of `side` (negating a mate score keeps its distance). */
export function evalFor(e: number, side: Color): number {
  return side === "w" ? e : e === 0 ? 0 : -e;
}

/** An engine score as UCI prints it (relative to the side to move) → stored eval (White POV). */
export function fromEngineScore(score: { cp: number } | { mate: number }, sideToMove: Color): number {
  if ("cp" in score) return encodeCp(sideToMove === "w" ? score.cp : -score.cp);
  const n = score.mate;
  if (!Number.isInteger(n)) throw new RangeError(`invalid mate score ${n}`);
  if (n === 0) return encodeMate(sideToMove === "w" ? "b" : "w", 0); // the side to move is checkmated
  const moverMates = n > 0;
  const winner: Color = moverMates === (sideToMove === "w") ? "w" : "b";
  return encodeMate(winner, Math.abs(n));
}

/** `second[i]` decoder: `null` when the position has no second legal move. */
export function decodeSecond(s: number): DecodedEval | null {
  return s === NO_SECOND ? null : decodeEval(s);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Ply numbering (§8.1)                                                                                         */
/* ------------------------------------------------------------------------------------------------------------ */

/** Side to move before ply offset `i` of a game whose first position has `startMover` to move. */
export function moverAt(i: number, startMover: Color): Color {
  return (i % 2 === 0) === (startMover === "w") ? "w" : "b";
}

/**
 * Move number of ply offset `i` (§8.1: `floor((startPly + i) / 2) + 1`), where `startPly` is the absolute ply of
 * the first position (0 for the initial position; a FEN start with Black to move at move 10 has startPly 19).
 */
export function moveNo(i: number, startPly: number): number {
  return Math.floor((startPly + i) / 2) + 1;
}

/** "17." for White, "17…" for Black: the label in front of a SAN. */
export function moveLabel(i: number, startPly: number): string {
  return `${moveNo(i, startPly)}${(startPly + i) % 2 === 0 ? "." : "…"}`;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Live progress deltas (§5.2 "Delta merge", §5.11 `analysis:progress`)                                         */
/* ------------------------------------------------------------------------------------------------------------ */

export type ReviewStatus = "none" | "queued" | "running" | "done" | "failed" | "skipped";

/** The per-ply part of the review payload's `analysis` that progress deltas update. */
export interface PliesState {
  gradedPlies: number;
  totalPlies: number;
  /** White-POV evals, index = position (0 = before the first ply). */
  evals: number[];
  /** `best` tokens, one per ply (index = ply), `-` unknown. */
  best: string;
  /** `j` chars, one per ply (index = ply), `.` ungraded. */
  j: string;
  /** Present on the review DTO; cleared when a delta shows the job running again. */
  failure?: unknown;
  /** Present on the review DTO; cleared once the job runs. */
  queue?: unknown;
}

/**
 * One `analysis:progress` frame. Contract (binding for the worker, WP-C, and the socket schema, WP-D):
 * - `evals[k]` is position `from + k`; `best` token k and `j[k]` are ply `from + k`.
 * - `gradedPlies` is the number of graded plies after the frame (plies `0 … gradedPlies − 1` carry a judgement).
 * - The worker starts every frame at the last checkpoint (or the resume point), at most 10 plies back, so a client
 *   holding the database snapshot (A1 reads the last checkpoint) can always splice it in; see `deltaFit`.
 */
export interface PliesDelta {
  from: number;
  gradedPlies: number;
  totalPlies: number;
  evals: number[];
  best: string;
  j: string;
}

export type DeltaFit = "apply" | "stale" | "gap" | "closed";

/**
 * Whether a delta can be merged into the cached payload:
 * - `closed`: no live analysis to update (no `analysis` object, or the status is done or skipped): refetch on done;
 * - `stale`: it adds nothing (`ev.gradedPlies <= state.gradedPlies`): drop it;
 * - `gap`: it starts after the plies the cache holds (`ev.from > state.gradedPlies`): refetch the payload (A1);
 * - `apply`: splice it in.
 */
export function deltaFit(d: { status: ReviewStatus; analysis: PliesState | null }, ev: PliesDelta): DeltaFit {
  if (!d.analysis || d.status === "done" || d.status === "skipped") return "closed";
  if (ev.gradedPlies <= d.analysis.gradedPlies) return "stale";
  if (!Number.isInteger(ev.from) || ev.from < 0 || ev.from > d.analysis.gradedPlies) return "gap";
  return "apply";
}

function spliceArray<T>(base: readonly T[], from: number, items: readonly T[], pad: T): T[] {
  const out = base.slice();
  while (out.length < from) out.push(pad);
  for (let k = 0; k < items.length; k++) out[from + k] = items[k] as T;
  return out;
}

/**
 * Splices an `analysis:progress` frame into a review payload (the client's `setQueryData` updater). Returns the
 * same object when the frame does not fit (`deltaFit` ≠ "apply"), so React Query keeps the cached reference.
 * Values beyond the frame are kept (a payload may carry full-length `best`/`j` strings with `-`/`.` padding).
 */
export function mergePlies<T extends { status: ReviewStatus; analysis: PliesState | null }>(d: T, ev: PliesDelta): T {
  if (deltaFit(d, ev) !== "apply") return d;
  const a = d.analysis as PliesState;
  const bestTokens = a.best === "" ? [] : a.best.split(" ");
  const evBest = ev.best === "" ? [] : ev.best.split(" ");
  const analysis: PliesState = {
    ...a,
    gradedPlies: ev.gradedPlies,
    totalPlies: ev.totalPlies,
    evals: spliceArray(a.evals, ev.from, ev.evals, 0),
    best: spliceArray(bestTokens, ev.from, evBest, "-").join(" "),
    j: spliceArray(a.j.split(""), ev.from, ev.j.split(""), ".").join(""),
  };
  if ("failure" in a) analysis.failure = null;
  if ("queue" in a) analysis.queue = null;
  // A frame proves the job is running (it may have been queued, or failed and retried).
  return { ...d, status: "running", analysis };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Weakness inputs (phase-06 plan §6.4): STATS_V1 and ERROR_LOG_V1, append-only like the codes above            */
/* ------------------------------------------------------------------------------------------------------------ */
//
// Both live in `game_players` smallint[] columns written by the worker's final analysis batch, the B-W1 backfill and
// the weakness heal (`weakness-inputs.ts#computeSideInputs` builds them). "Error" means a MISTAKE, BLUNDER or MISS ply
// of the side, the same set in both encodings. A slot's or a field's meaning never changes once stored: a new field
// is a new version (STATS_V2, `weaknessInputsV` = 2), never a reinterpretation.

/** STATS_V1 has 30 smallints per member side. */
export const STATS_V1_LENGTH = 30;

/**
 * STATS_V1 slot offsets (data-model §3.10):
 *
 * | Slot  | Content                                                                                             |
 * |-------|-----------------------------------------------------------------------------------------------------|
 * | 0     | moves: this side's graded plies, excluding BOOK and FORCED                                          |
 * | 1–3   | moves by phase: opening, middlegame, endgame (Divider plies)                                        |
 * | 4–6   | errors by phase                                                                                     |
 * | 7–10  | moves by the clock before the move: gt5, 2to5, 1to2, lt1 (unknown clocks count in none)             |
 * | 11–14 | errors by clock bucket, same order                                                                  |
 * | 15–20 | moves by the moved piece: p n b r q k                                                               |
 * | 21–26 | errors by moved piece                                                                               |
 * | 27    | reached +300 cp (side POV) after one of this side's moves: 0/1                                      |
 * | 28    | converted: slot 27 = 1 and the result is WIN: 0/1                                                   |
 * | 29    | Win% (side POV) after this side's first non-BOOK move, rounded; −1 = unknown (FEN start, no book)   |
 */
export const STATS_V1 = {
  MOVES: 0,
  PHASE_MOVES: 1,
  PHASE_ERRORS: 4,
  CLOCK_MOVES: 7,
  CLOCK_ERRORS: 11,
  PIECE_MOVES: 15,
  PIECE_ERRORS: 21,
  REACHED_PLUS3: 27,
  CONVERTED: 28,
  BOOK_EXIT_WIN: 29,
} as const;

/** The +300 cp threshold of STATS_V1 slot 27 (plan §8.1 CONVERSION_CP). */
export const STATS_V1_REACHED_CP = 300;

/** Piece order of STATS_V1 slots 15–20 and 21–26. */
export const STATS_V1_PIECES = ["p", "n", "b", "r", "q", "k"] as const;
export type StatsPiece = (typeof STATS_V1_PIECES)[number];

/** Phase order of the STATS_V1 phase slots and of ERROR_LOG_V1's phase field (index = stored value). */
export const WEAKNESS_PHASES = ["opening", "middlegame", "endgame"] as const;
export type WeaknessPhase = (typeof WEAKNESS_PHASES)[number];

/** The decoded STATS_V1 record. Tuples are in the slot order above. */
export interface StatsV1 {
  moves: number;
  phaseMoves: [number, number, number];
  phaseErrors: [number, number, number];
  /** gt5, 2to5, 1to2, lt1 */
  clockMoves: [number, number, number, number];
  clockErrors: [number, number, number, number];
  /** p n b r q k */
  pieceMoves: [number, number, number, number, number, number];
  pieceErrors: [number, number, number, number, number, number];
  reachedPlus3: boolean;
  converted: boolean;
  /** Rounded Win% 0…100 after the side's first non-BOOK move; null = unknown (stored −1). */
  bookExitWin: number | null;
}

const SMALLINT_MAX = 32767;

function assertCount(v: number, what: string): void {
  if (!Number.isInteger(v) || v < 0 || v > SMALLINT_MAX) throw new RangeError(`STATS_V1 ${what}: invalid count ${v}`);
}

/** A zeroed record (no moves). */
export function emptyStatsV1(): StatsV1 {
  return {
    moves: 0,
    phaseMoves: [0, 0, 0],
    phaseErrors: [0, 0, 0],
    clockMoves: [0, 0, 0, 0],
    clockErrors: [0, 0, 0, 0],
    pieceMoves: [0, 0, 0, 0, 0, 0],
    pieceErrors: [0, 0, 0, 0, 0, 0],
    reachedPlus3: false,
    converted: false,
    bookExitWin: null,
  };
}

/** Record → the 30-slot smallint[]. Throws on a negative, fractional or out-of-range value. */
export function encodeStatsV1(s: StatsV1): number[] {
  const out: number[] = [s.moves, ...s.phaseMoves, ...s.phaseErrors, ...s.clockMoves, ...s.clockErrors, ...s.pieceMoves, ...s.pieceErrors];
  out.forEach((v, i) => assertCount(v, `slot ${i}`));
  if (s.converted && !s.reachedPlus3) throw new RangeError("STATS_V1: converted without reaching +300");
  const exit = s.bookExitWin;
  if (exit !== null && !(Number.isInteger(exit) && exit >= 0 && exit <= 100)) {
    throw new RangeError(`STATS_V1 slot 29: invalid Win% ${exit}`);
  }
  out.push(s.reachedPlus3 ? 1 : 0, s.converted ? 1 : 0, exit ?? -1);
  if (out.length !== STATS_V1_LENGTH) throw new RangeError(`STATS_V1: ${out.length} slots`);
  return out;
}

function slots(a: readonly number[], from: number, n: number): number[] {
  return a.slice(from, from + n);
}

/**
 * The stored smallint[] → record. `null` for "not computed / unknown": an empty array, an older shorter array, or any
 * other length (callers treat the row as missing inputs and heal it). Throws on a 30-slot array with an impossible
 * value (a corrupt row must not be averaged in silently).
 */
export function decodeStatsV1(a: readonly number[] | null | undefined): StatsV1 | null {
  if (!a || a.length !== STATS_V1_LENGTH) return null;
  for (let i = 0; i < STATS_V1.REACHED_PLUS3; i++) assertCount(a[i] as number, `slot ${i}`);
  const r = a[STATS_V1.REACHED_PLUS3];
  const c = a[STATS_V1.CONVERTED];
  const w = a[STATS_V1.BOOK_EXIT_WIN] as number;
  if ((r !== 0 && r !== 1) || (c !== 0 && c !== 1) || (c === 1 && r !== 1)) throw new RangeError("STATS_V1: invalid conversion slots");
  if (!(Number.isInteger(w) && w >= -1 && w <= 100)) throw new RangeError(`STATS_V1 slot 29: invalid Win% ${w}`);
  return {
    moves: a[STATS_V1.MOVES] as number,
    phaseMoves: slots(a, STATS_V1.PHASE_MOVES, 3) as StatsV1["phaseMoves"],
    phaseErrors: slots(a, STATS_V1.PHASE_ERRORS, 3) as StatsV1["phaseErrors"],
    clockMoves: slots(a, STATS_V1.CLOCK_MOVES, 4) as StatsV1["clockMoves"],
    clockErrors: slots(a, STATS_V1.CLOCK_ERRORS, 4) as StatsV1["clockErrors"],
    pieceMoves: slots(a, STATS_V1.PIECE_MOVES, 6) as StatsV1["pieceMoves"],
    pieceErrors: slots(a, STATS_V1.PIECE_ERRORS, 6) as StatsV1["pieceErrors"],
    reachedPlus3: r === 1,
    converted: c === 1,
    bookExitWin: w === -1 ? null : w,
  };
}

/**
 * ERROR_LOG_V1: one smallint per error of the side, in ply order.
 *
 * | Bits  | Field        | Values                                                                                     |
 * |-------|--------------|--------------------------------------------------------------------------------------------|
 * | 0–6   | winLoss      | clamp(round(winBefore − winAfterPlayed), 0, 100), Win% points from the mover's side         |
 * | 7–9   | clockBucket  | 0 unknown or untimed, 1 > 5 min, 2 2–5 min, 3 1–2 min, 4 < 1 min (clock.ts, before the move)|
 * | 10–11 | phase        | 0 opening, 1 middlegame, 2 endgame (WEAKNESS_PHASES)                                       |
 * | 12–13 | judgement    | 0 MISTAKE, 1 BLUNDER, 2 MISS (ERROR_LOG_JUDGEMENTS; inaccuracies are never logged)          |
 */
export const ERROR_LOG_V1 = {
  CLOCK_SHIFT: 7,
  PHASE_SHIFT: 10,
  JUDGEMENT_SHIFT: 12,
  WIN_LOSS_MAX: 100,
  CLOCK_MAX: 4,
  PHASE_MAX: 2,
  JUDGEMENT_MAX: 2,
  /** (2 << 12) | (2 << 10) | (4 << 7) | 100 */
  MAX_VALUE: 10852,
} as const;

/** ERROR_LOG_V1 judgement names, index = the stored field value. */
export const ERROR_LOG_JUDGEMENTS = ["MISTAKE", "BLUNDER", "MISS"] as const;

/** 0 MISTAKE, 1 BLUNDER, 2 MISS */
export type ErrorLogJudgement = 0 | 1 | 2;

/** The stored judgement values by name (`ERROR_LOG_JUDGEMENTS[ERROR_LOG_J.BLUNDER] === "BLUNDER"`). */
export const ERROR_LOG_J = { MISTAKE: 0, BLUNDER: 1, MISS: 2 } as const satisfies Record<(typeof ERROR_LOG_JUDGEMENTS)[number], ErrorLogJudgement>;

/** At most this many themes are kept per error: each `game_players."errorThemeN"` entry is 0…ERROR_THEMES_MAX. */
export const ERROR_THEMES_MAX = 8;
/** 0 opening, 1 middlegame, 2 endgame */
export type ErrorLogPhase = 0 | 1 | 2;
/** 0 unknown, 1 gt5, 2 2to5, 3 1to2, 4 lt1 */
export type ErrorLogClock = 0 | 1 | 2 | 3 | 4;

export interface ErrorLogEntry {
  judgement: ErrorLogJudgement;
  phase: ErrorLogPhase;
  clockBucket: ErrorLogClock;
  /** Win% points lost by the move, integer 0…100 */
  winLoss: number;
}

/** JudgementCode → the ERROR_LOG_V1 judgement, or null for a ply that is not an error (inaccuracies included). */
export function errorJudgementOf(code: number): ErrorLogJudgement | null {
  if (code === J.MISTAKE) return ERROR_LOG_J.MISTAKE;
  if (code === J.BLUNDER) return ERROR_LOG_J.BLUNDER;
  if (code === J.MISS) return ERROR_LOG_J.MISS;
  return null;
}

function inRange(v: number, max: number): boolean {
  return Number.isInteger(v) && v >= 0 && v <= max;
}

/** One error → its stored smallint. Throws on any field out of range. */
export function encodeErrorLog(e: ErrorLogEntry): number {
  if (!inRange(e.judgement, ERROR_LOG_V1.JUDGEMENT_MAX)) throw new RangeError(`ERROR_LOG_V1: invalid judgement ${e.judgement}`);
  if (!inRange(e.phase, ERROR_LOG_V1.PHASE_MAX)) throw new RangeError(`ERROR_LOG_V1: invalid phase ${e.phase}`);
  if (!inRange(e.clockBucket, ERROR_LOG_V1.CLOCK_MAX)) throw new RangeError(`ERROR_LOG_V1: invalid clock bucket ${e.clockBucket}`);
  if (!inRange(e.winLoss, ERROR_LOG_V1.WIN_LOSS_MAX)) throw new RangeError(`ERROR_LOG_V1: invalid winLoss ${e.winLoss}`);
  return (e.judgement << ERROR_LOG_V1.JUDGEMENT_SHIFT) | (e.phase << ERROR_LOG_V1.PHASE_SHIFT) | (e.clockBucket << ERROR_LOG_V1.CLOCK_SHIFT) | e.winLoss;
}

/** One stored smallint → the error. Throws on a value no entry encodes to. */
export function decodeErrorLog(code: number): ErrorLogEntry {
  if (!Number.isInteger(code) || code < 0 || code > ERROR_LOG_V1.MAX_VALUE) throw new RangeError(`ERROR_LOG_V1: invalid value ${code}`);
  const winLoss = code & 0x7f;
  const clockBucket = (code >> ERROR_LOG_V1.CLOCK_SHIFT) & 0x7;
  const phase = (code >> ERROR_LOG_V1.PHASE_SHIFT) & 0x3;
  const judgement = (code >> ERROR_LOG_V1.JUDGEMENT_SHIFT) & 0x3;
  if (
    winLoss > ERROR_LOG_V1.WIN_LOSS_MAX ||
    clockBucket > ERROR_LOG_V1.CLOCK_MAX ||
    phase > ERROR_LOG_V1.PHASE_MAX ||
    judgement > ERROR_LOG_V1.JUDGEMENT_MAX
  ) {
    throw new RangeError(`ERROR_LOG_V1: invalid value ${code}`);
  }
  return {
    judgement: judgement as ErrorLogJudgement,
    phase: phase as ErrorLogPhase,
    clockBucket: clockBucket as ErrorLogClock,
    winLoss,
  };
}

/** A stored `errorLog` array → its entries, in order. */
export function decodeErrorLogs(codes: readonly number[]): ErrorLogEntry[] {
  return codes.map(decodeErrorLog);
}
