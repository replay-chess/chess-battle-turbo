// Types shared by the live-game store (`@repo/db/live`) and the creators (`@repo/db/games`).
//
// Everything in these modules is raw SQL through `$queryRaw`/`$executeRaw` (one statement per call: the socket
// server sits ~220 ms from Neon, phase-02 plan 6.6), so they depend only on the shape below, not on the generated
// model types. Any PrismaClient, an extended client (`$extends`) or an interactive-transaction client fits.
import type { Prisma } from "#generated";

export interface SqlClient {
  $queryRaw<T = unknown>(query: Prisma.Sql): PromiseLike<T>;
  $executeRaw(query: Prisma.Sql): PromiseLike<number>;
}

// The M2 enums as string unions (same values as the generated `$Enums`).
export type GameStatus = "WAITING_FOR_OPPONENT" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "EXPIRED" | "ABORTED";
export type GameMode = "LEGEND_BOT" | "BOT" | "FRIEND" | "ONLINE" | "TOURNAMENT" | "IMPORTED";
export type LiveGameMode = Exclude<GameMode, "IMPORTED">;
export type GameSource = "REPLAY" | "CHESSCOM" | "LICHESS";
export type TimeClass = "BULLET" | "BLITZ" | "RAPID" | "CLASSICAL" | "DAILY" | "UNTIMED";
export type GameEndMethod =
  | "CHECKMATE"
  | "RESIGNATION"
  | "TIMEOUT"
  | "TIMEOUT_VS_INSUFFICIENT"
  | "STALEMATE"
  | "THREEFOLD"
  | "FIFTY_MOVE"
  | "INSUFFICIENT_MATERIAL"
  | "AGREEMENT"
  | "ABANDONED"
  | "ABORTED"
  | "OTHER";
export type GameWinner = "WHITE" | "BLACK" | "DRAW" | "NONE";
export type LivePhase = "WAITING" | "STUDY" | "FIRST_MOVE" | "PLAYING" | "ENDED";
export type PlayerResult = "WIN" | "LOSS" | "DRAW" | "ABORTED";

export type Side = "w" | "b";

// Wire names (protocol v2, @repo/contracts/socket/game): lower-case.
export type WirePhase = "waiting" | "study" | "first_move" | "playing" | "ended";
export type WireEndMethod =
  | "checkmate"
  | "resignation"
  | "timeout"
  | "timeout_vs_insufficient"
  | "stalemate"
  | "threefold"
  | "fifty_move"
  | "insufficient_material"
  | "agreement"
  | "abandoned"
  | "aborted";
export type WireTimeClass = "bullet" | "blitz" | "rapid" | "classical" | "untimed";

export const PHASE_TO_DB: Record<WirePhase, LivePhase> = {
  waiting: "WAITING",
  study: "STUDY",
  first_move: "FIRST_MOVE",
  playing: "PLAYING",
  ended: "ENDED",
};

export const PHASE_FROM_DB: Record<LivePhase, WirePhase> = {
  WAITING: "waiting",
  STUDY: "study",
  FIRST_MOVE: "first_move",
  PLAYING: "playing",
  ENDED: "ended",
};

export const END_METHOD_TO_DB: Record<WireEndMethod, GameEndMethod> = {
  checkmate: "CHECKMATE",
  resignation: "RESIGNATION",
  timeout: "TIMEOUT",
  timeout_vs_insufficient: "TIMEOUT_VS_INSUFFICIENT",
  stalemate: "STALEMATE",
  threefold: "THREEFOLD",
  fifty_move: "FIFTY_MOVE",
  insufficient_material: "INSUFFICIENT_MATERIAL",
  agreement: "AGREEMENT",
  abandoned: "ABANDONED",
  aborted: "ABORTED",
};

/** `OTHER` (imports only) has no wire name; it reads as `null`. */
export function endMethodFromDb(method: GameEndMethod | null): WireEndMethod | null {
  if (method == null || method === "OTHER") return null;
  return method.toLowerCase() as WireEndMethod;
}

/** `DAILY` (imports only) reads as `classical` on the wire, the closest pool (plan 8.11). */
export function timeClassToWire(tc: TimeClass | null): WireTimeClass {
  switch (tc) {
    case "BULLET":
      return "bullet";
    case "BLITZ":
      return "blitz";
    case "RAPID":
      return "rapid";
    case "CLASSICAL":
    case "DAILY":
      return "classical";
    default:
      return "untimed";
  }
}

/** Winner side → stored outcome. `null` winner = a draw (aborted games use `abortGame`, outcome NONE). */
export function outcomeOf(winner: Side | null): Exclude<GameWinner, "NONE"> {
  return winner === "w" ? "WHITE" : winner === "b" ? "BLACK" : "DRAW";
}

export function winnerOf(outcome: GameWinner | null): Side | null {
  return outcome === "WHITE" ? "w" : outcome === "BLACK" ? "b" : null;
}

/** Clock values go to `int` / `int[]` columns: whole milliseconds (a fractional value is refused with 22P03). */
export const intMs = (v: number): number => Math.round(v);
export const intMsOrNull = (v: number | null): number | null => (v === null ? null : Math.round(v));
