// Test data builders for the Weakness Profile engine (phase-06 plan §12.1; interface check §0.1: a seeded mulberry32,
// no new dependency). `gameInput()` encodes a readable game spec into the stored records with the real codecs
// (CA/src/codec.ts STATS_V1 / ERROR_LOG_V1), so the engine is always tested through the same bytes the worker writes.
// `randomGames()` draws reproducible scopes for the property tests. Pure (no Node built-ins).
import { encodeErrorLog, encodeStatsV1, type ErrorLogClock, type ErrorLogJudgement, type ErrorLogPhase } from "@repo/chess-analysis/codec";
import type { DbTimeClass, GameModeDb, GameSourceDb, PlayerResultDb, WeaknessGameInput } from "../src/weakness/types";

/** Deterministic PRNG (mulberry32), the same algorithm as src/session.ts. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(rnd: () => number, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
export const int = (rnd: () => number, lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));

export interface ErrorSpec {
  judgement: ErrorLogJudgement;
  phase: ErrorLogPhase;
  /** 0 unknown, 1 gt5, 2 2to5, 3 1to2, 4 lt1. */
  clockBucket: ErrorLogClock;
  winLoss: number;
  themes: readonly string[];
  /** Index of the moved piece (p n b r q k), for STATS_V1 slots 21–26. */
  piece?: number;
}

export interface GameSpec {
  gameId: string;
  color: "w" | "b";
  endedAt: Date | null;
  timeClass?: DbTimeClass | null;
  mode?: GameModeDb;
  result?: PlayerResultDb | null;
  ratingBefore?: number | null;
  rated?: boolean;
  source?: GameSourceDb;
  oppTitle?: string | null;
  ecoCode?: string | null;
  evalSource?: WeaknessGameInput["evalSource"];
  /** Not analysed: accuracy null, no inputs. */
  unanalysed?: boolean;
  /** Analysed but its inputs not computed yet (weaknessInputsV 0, the heal's job). */
  noInputs?: boolean;
  accuracy?: number;
  phaseAccuracy?: [number, number, number];
  /** [opening, middlegame, endgame] moves; Σ = moves. */
  phaseMoves?: [number, number, number];
  /** [gt5, 2to5, 1to2, lt1] moves; Σ ≤ moves (the rest has no clock). */
  clockMoves?: [number, number, number, number];
  pieceMoves?: [number, number, number, number, number, number];
  reachedPlus3?: boolean;
  converted?: boolean;
  bookExitWin?: number | null;
  errors?: readonly ErrorSpec[];
}

/** Encodes a spec into the `game_players` row shape the engine reads. */
export function gameInput(s: GameSpec): WeaknessGameInput {
  const base = {
    gameId: s.gameId,
    color: s.color,
    endedAt: s.endedAt,
    timeClass: s.timeClass === undefined ? "BLITZ" : s.timeClass,
    mode: s.mode ?? "IMPORTED",
    result: s.result === undefined ? "WIN" : s.result,
    ratingBefore: s.ratingBefore === undefined ? null : s.ratingBefore,
    rated: s.rated ?? true,
    source: s.source ?? "LICHESS",
    oppTitle: s.oppTitle ?? null,
    ecoCode: s.ecoCode ?? null,
    evalSource: s.evalSource ?? "ENGINE",
  } satisfies Partial<WeaknessGameInput>;
  if (s.unanalysed) {
    return { ...base, accuracy: null, phaseAccuracy: [], stats: [], errorLog: [], errorThemeN: [], errorThemes: [], weaknessInputsV: 0 };
  }
  const errors = s.errors ?? [];
  const phaseMoves = s.phaseMoves ?? [12, 22, 11];
  const moves = phaseMoves[0] + phaseMoves[1] + phaseMoves[2];
  const clockMoves = s.clockMoves ?? [Math.round(moves * 0.5), Math.round(moves * 0.3), moves - Math.round(moves * 0.5) - Math.round(moves * 0.3), 0];
  const pieceMoves = s.pieceMoves ?? distribute(moves, [14, 8, 8, 7, 5, 3]);
  const phaseErrors: [number, number, number] = [0, 0, 0];
  const clockErrors: [number, number, number, number] = [0, 0, 0, 0];
  const pieceErrors: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  errors.forEach((e, i) => {
    phaseErrors[e.phase] += 1;
    if (e.clockBucket > 0) clockErrors[e.clockBucket - 1] = clockErrors[e.clockBucket - 1]! + 1;
    const piece = e.piece ?? i % 6;
    pieceErrors[piece] = pieceErrors[piece]! + 1;
  });
  const reachedPlus3 = s.reachedPlus3 ?? false;
  const stats = encodeStatsV1({
    moves,
    phaseMoves,
    phaseErrors,
    clockMoves,
    clockErrors,
    pieceMoves,
    pieceErrors,
    reachedPlus3,
    converted: reachedPlus3 && (s.converted ?? false),
    bookExitWin: s.bookExitWin === undefined ? null : s.bookExitWin,
  });
  const record = {
    ...base,
    accuracy: s.accuracy ?? 80,
    phaseAccuracy: s.phaseAccuracy ?? [85, 75, phaseMoves[2] > 0 ? 75 : -1],
    stats,
    errorLog: errors.map((e) => encodeErrorLog(e)),
    errorThemeN: errors.map((e) => e.themes.length),
    errorThemes: errors.flatMap((e) => [...e.themes]),
    weaknessInputsV: 1,
  };
  return s.noInputs ? { ...record, stats: [], errorLog: [], errorThemeN: [], errorThemes: [], weaknessInputsV: 0 } : record;
}

/** Splits `total` in the proportions of `weights` (integers summing to `total`). */
export function distribute<N extends number>(total: number, weights: readonly number[] & { length: N }): [number, number, number, number, number, number] {
  const sum = weights.reduce((s, w) => s + w, 0);
  const out = weights.map((w) => Math.floor((total * w) / sum));
  let rest = total - out.reduce((s, x) => s + x, 0);
  for (let i = 0; rest > 0; i = (i + 1) % out.length, rest--) out[i]! += 1;
  return out as [number, number, number, number, number, number];
}

/** A themed error with defaults (a middlegame MISTAKE with 2–5 minutes on the clock). */
export function err(themes: readonly string[], o: Partial<ErrorSpec> = {}): ErrorSpec {
  return { judgement: 0, phase: 1, clockBucket: 2, winLoss: 15, themes, ...o };
}

const DAY = 86_400_000;
const THEME_POOL = ["fork", "pin", "hangingPiece", "skewer", "rc:missedThreat", "rc:development", "backRankMate", "rookEndgame", "mateIn2", "rc:recapture"];

export interface RandomGameOptions {
  now: Date;
  /** Fraction of analysed rows. */
  analysedShare?: number;
  /** Days back the games spread over. */
  days?: number;
}

/** One random game side (in or out of the default scope; analysed or not; timed or not). */
export function randomGame(rnd: () => number, i: number, o: RandomGameOptions): WeaknessGameInput {
  const days = o.days ?? 150;
  const endedAt = rnd() < 0.02 ? null : new Date(o.now.getTime() - Math.floor(rnd() * days * DAY) - 60_000);
  const timeClass = pick(rnd, ["BLITZ", "BLITZ", "RAPID", "RAPID", "BULLET", "CLASSICAL", "DAILY"] as const);
  const mode = pick(rnd, ["IMPORTED", "IMPORTED", "ONLINE", "FRIEND", "BOT", "TOURNAMENT"] as const);
  const result = pick(rnd, ["WIN", "LOSS", "DRAW", "LOSS", "WIN", "ABORTED"] as const);
  const source = mode === "IMPORTED" ? pick(rnd, ["LICHESS", "CHESSCOM"] as const) : "REPLAY";
  const timed = timeClass !== "DAILY" && rnd() > 0.1;
  const pm: [number, number, number] = [int(rnd, 3, 15), int(rnd, 5, 30), rnd() < 0.6 ? int(rnd, 3, 20) : 0];
  const moves = pm[0] + pm[1] + pm[2];
  const lt1 = timed ? int(rnd, 0, Math.min(8, moves)) : 0;
  const rest = moves - lt1;
  const clockMoves: [number, number, number, number] = timed ? [Math.floor(rest * 0.5), Math.floor(rest * 0.3), rest - Math.floor(rest * 0.5) - Math.floor(rest * 0.3), lt1] : [0, 0, 0, 0];
  const nErr = int(rnd, 0, 6);
  const errors: ErrorSpec[] = [];
  for (let e = 0; e < nErr; e++) {
    const phase = pick(rnd, pm[2] > 0 ? ([0, 1, 1, 2] as const) : ([0, 1, 1] as const));
    const buckets = timed ? ([1, 2, 3, ...(lt1 > 0 ? [4] : [])] as ErrorLogClock[]) : [0 as ErrorLogClock];
    const nThemes = int(rnd, 0, 2);
    const themes = [...new Set(Array.from({ length: nThemes }, () => pick(rnd, THEME_POOL)))];
    errors.push({ judgement: pick(rnd, [0, 1, 2] as const), phase, clockBucket: pick(rnd, buckets), winLoss: int(rnd, 0, 100), themes });
  }
  const reached = rnd() < 0.3;
  return gameInput({
    gameId: String(1000 + i),
    color: rnd() < 0.5 ? "w" : "b",
    endedAt,
    timeClass,
    mode,
    result,
    ratingBefore: rnd() < 0.8 ? int(rnd, 900, 1600) : null,
    rated: rnd() < 0.7,
    source,
    oppTitle: source !== "REPLAY" && rnd() < 0.05 ? "BOT" : null,
    ecoCode: rnd() < 0.9 ? `${pick(rnd, ["A", "B", "C", "D", "E"])}${String(int(rnd, 0, 99)).padStart(2, "0")}` : null,
    unanalysed: rnd() > (o.analysedShare ?? 0.7),
    phaseMoves: pm,
    clockMoves,
    reachedPlus3: reached,
    converted: reached && rnd() < 0.7,
    bookExitWin: rnd() < 0.6 ? int(rnd, 20, 80) : null,
    phaseAccuracy: [int(rnd, 60, 98), int(rnd, 50, 95), pm[2] > 0 ? int(rnd, 50, 95) : -1],
    errors,
  });
}

/** `n` random game sides from `seed` (reproducible). */
export function randomGames(seed: number, n: number, o: RandomGameOptions): WeaknessGameInput[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: n }, (_, i) => randomGame(rnd, i, o));
}

/** JSON form of an input row (dates as ISO strings), for committed fixtures. */
export type GameInputJson = Omit<WeaknessGameInput, "endedAt"> & { endedAt: string | null };

export function toJson(g: WeaknessGameInput): GameInputJson {
  return { ...g, endedAt: g.endedAt ? g.endedAt.toISOString() : null };
}

export function fromJson(g: GameInputJson): WeaknessGameInput {
  return { ...g, endedAt: g.endedAt ? new Date(g.endedAt) : null };
}
