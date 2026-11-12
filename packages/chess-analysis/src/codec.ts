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
