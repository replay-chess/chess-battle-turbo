// The mappers' common output (phase-04 plan §8.6 "Mapping one game", §8.7 step 3, §8.8 `src` record). Field names
// are the batch writer's `jsonb_to_recordset` columns, which write P2's shipped names (D4-22): `endedAt` →
// `games."completedAt"`, `games."expiresAt"` and `game_players."endedAt"`; `fen` → `games.fen`; `outcome` →
// `games.outcome` (`GameWinner`); `endMethod` → `games."endMethod"`; `legacyResult` → `games.result`. Enum values are
// the Postgres spellings (interface-check §2). The worker adds `referenceId`, `ord`, `priority` and `fairSeq`.
import type { TimeClass } from "./time-class";

export type ImportSource = "CHESSCOM" | "LICHESS";

/** `GameEndMethod` values an import can produce (`ABORTED` games are skipped, never stored). */
export type ImportEndMethod =
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
  | "OTHER";

/** `GameWinner` without `NONE` (aborted games are skipped). */
export type ImportOutcome = "WHITE" | "BLACK" | "DRAW";
/** `PlayerResult` for the member's side. */
export type ImportPlayerResult = "WIN" | "LOSS" | "DRAW";
/** Legacy `GameResult` from the member's side (the member is the legacy "creator"). */
export type ImportLegacyResult = "CREATOR_WON" | "OPPONENT_WON" | "DRAW";
export type Colour = "w" | "b";

/** White-POV evaluation per ply from the Lichess export (`AnalyzeGamePayloadV1.evalHint`, §6.4, R-LI-08). */
export interface EvalHint {
  source: "lichess";
  /** One value per ply in P3's eval encoding (CA/src/codec.ts): cp clamped to ±9999; mate = sign·(30000 − n). */
  cp: number[];
}

export interface ImportedGame {
  source: ImportSource;
  /** ≤ 40 chars; unique with `source` (`games_source_externalId_key`). */
  externalId: string;
  /** ≤ 120 chars. */
  externalUrl: string;
  timeClass: TimeClass;
  rated: boolean;
  /** When the game ended (UTC). */
  endedAt: Date;
  /** When the game started, if the provider says (Lichess `createdAt` drives the import cursor, §8.7 step 4). */
  createdAtMs: number | null;
  whiteName: string;
  blackName: string;
  whiteRating: number | null;
  blackRating: number | null;
  whiteTitle: string | null;
  blackTitle: string | null;
  outcome: ImportOutcome;
  endMethod: ImportEndMethod;
  legacyResult: ImportLegacyResult;
  /** `[A-E]\d\d` or null. */
  ecoCode: string | null;
  /** ≤ 80 chars or null. */
  openingName: string | null;
  /** Space-separated UCI from `startingFen` (P2's `games.moves`). */
  moves: string;
  /** Mover's remaining ms after each ply, one per ply; empty when the provider has no clocks. */
  moveClocksMs: number[];
  plyCount: number;
  startPly: number;
  startingFen: string;
  /** Final position after the last ply. */
  fen: string;
  initialTimeSeconds: number;
  incrementSeconds: number;
  /** Legacy NOT NULL columns: last clock of the member's side / the opponent's side, in seconds (0 when none). */
  creatorTimeRemaining: number;
  opponentTimeRemaining: number;
  memberWon: boolean;
  /** The member's colour. */
  color: Colour;
  result: ImportPlayerResult;
  ratingBefore: number | null;
  ratingDelta: number | null;
  /** ≤ 40 chars. */
  opponentName: string;
  opponentRating: number | null;
  evalHint: EvalHint | null;
}

/** Why a provider game is not imported; each is counted in `import_runs.skipped` (§8.6 step 5). */
export const SKIP_REASONS = [
  "variant",
  "unrated",
  "too_short",
  "not_participant",
  "parse_error",
  "aborted",
  "unfinished",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export type MapResult = { ok: true; game: ImportedGame } | { ok: false; reason: SkipReason; detail: string };

export const skip = (reason: SkipReason, detail: string): MapResult => ({ ok: false, reason, detail });

export const NAME_MAX = 40;
export const OPENING_NAME_MAX = 80;
export const TITLE_MAX = 4;
export const EXTERNAL_ID_MAX = 40;
export const EXTERNAL_URL_MAX = 120;

export const clip = (s: string, max: number): string => (s.length <= max ? s : s.slice(0, max));
