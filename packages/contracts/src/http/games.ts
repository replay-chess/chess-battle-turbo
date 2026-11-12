// HTTP contracts of the games area (phase-02 plan §7, §7.1.1–§7.1.5; phase-03 plan §7.1 G1 and the widened
// `complete` response). Registry entries: registry/games.ts.
// The snapshot is the socket protocol's GameState plus the HTTP-only fields, so the RSC, `GET /api/games/[ref]` and
// the socket join ack carry one shape.
import { z } from "zod";
import { EndMethod, GameState, TimeClassWire } from "../socket/game";
import { Color, CursorParam, FenLoose, IsoDateTime, Ref, Uci } from "./common";
import { GAMES_PAGE_LIMIT, GAMES_SEARCH_MAX, GAME_RESULT_FILTERS, GAME_TC_FILTERS } from "./plain";
import { AnalysisStatusWire, GameSourceWire, LegendSummaryDTO, Opening, PlayerKind } from "./review";

// The zod-free /games filter (plain.ts; the client imports it from there).
export {
  GAMES_PAGE_LIMIT,
  GAMES_SEARCH_MAX,
  GAMES_SEARCH_MIN,
  GAME_RESULT_FILTERS,
  GAME_TC_FILTERS,
  gamesFilterOf,
  gamesFilterToSearch,
  type GamesFilter,
} from "./plain";

export { EndMethod, GameState, Ref, Uci };

export const Side = Color;
export type Side = z.infer<typeof Side>;

/** Longest move list a bot game may checkpoint or complete. */
export const BOT_GAME_MAX_MOVES = 400;
/** A checkpoint `rev` more than this far ahead of the stored one is refused with 409 `rev_gap`. */
export const CHECKPOINT_REV_MAX_GAP = 64;

export const TimeControl = z
  .object({
    /** 15 s (fixtures) … 3 h. */
    initialSeconds: z.number().int().min(15).max(10_800),
    incrementSeconds: z.number().int().min(0).max(180),
  })
  .nullable();
export type TimeControl = z.infer<typeof TimeControl>;

/** Where a bot game starts. `random_position` is the legacy default of create-ai-game. */
export const GameStart = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("initial") }),
  z.object({ kind: z.literal("random_position") }),
  /** A random featured position of that legend. */
  z.object({ kind: z.literal("legend"), legendRef: Ref }),
  /** ChessPosition.referenceId. */
  z.object({ kind: z.literal("position"), positionRef: Ref }),
  z.object({ kind: z.literal("opening"), openingRef: Ref }),
]);
export type GameStart = z.infer<typeof GameStart>;

export const GameRefParams = z.object({ ref: Ref });
export type GameRefParams = z.infer<typeof GameRefParams>;

// ── POST /api/games (§7.1.1) ────────────────────────────────────────────────────────────────────────────────────
export const GameCreateBody = z.object({
  /** LEGEND_BOT → 400 validation_failed {details.reason: "mode_not_available"} until P8's flag. */
  mode: z.enum(["BOT", "LEGEND_BOT"]),
  start: GameStart.default({ kind: "random_position" }),
  /** auto = legacy rule: the opening's side / the legend's side / the side to move. */
  color: z.enum(["w", "b", "random", "auto"]).default("auto"),
  /** Default from the viewer's rating (§8.13). */
  botElo: z.number().int().min(400).max(2200).multipleOf(100).optional(),
  tc: TimeControl.default({ initialSeconds: 600, incrementSeconds: 0 }),
  parentGameRef: Ref.optional(),
  /** rematch: colours swapped vs the parent; restart: same colour, parent aborted if < 2 plies. */
  reason: z.enum(["new", "rematch", "restart"]).default("new"),
});
export type GameCreateBody = z.infer<typeof GameCreateBody>;
export type GameCreateInput = z.input<typeof GameCreateBody>;

// ── GET /api/games/[ref] (§7.1.2) ───────────────────────────────────────────────────────────────────────────────
export const GameStatusWire = z.enum(["WAITING_FOR_OPPONENT", "IN_PROGRESS", "COMPLETED", "ABORTED", "CANCELLED", "EXPIRED"]);
export type GameStatusWire = z.infer<typeof GameStatusWire>;

/** No `shareSig`: images of games come only from P3's shares (§7.1.6). */
export const GameSnapshot = GameState.extend({
  status: GameStatusWire,
  watchable: z.boolean(),
  /** Epoch ms (the ETag of finished games is built from it). */
  updatedAt: z.number().int().min(0),
  /** Bot journal revision (0 for live games). */
  rev: z.number().int().min(0),
});
export type GameSnapshot = z.infer<typeof GameSnapshot>;

/** 201. */
export const GameCreateResponse = z.object({ game: GameSnapshot });
export type GameCreateResponse = z.infer<typeof GameCreateResponse>;

export const GameDetailResponse = z.object({ snapshot: GameSnapshot });
export type GameDetailResponse = z.infer<typeof GameDetailResponse>;

// ── POST /api/games/[ref]/checkpoint and /complete (bot games, §7.1.3–§7.1.4) ───────────────────────────────────
export const Assists = z.object({ hints: z.number().int().min(0).max(10_000), undos: z.number().int().min(0).max(10_000) });
export type Assists = z.infer<typeof Assists>;

const clocksMatchMoves = (b: { moves: unknown[]; clocksMs: unknown[] }) =>
  b.clocksMs.length === 0 || b.clocksMs.length === b.moves.length;
const CLOCKS_ISSUE = { message: "clocksMs must be empty or as long as moves", path: ["clocksMs"] };

/** JSON or text/plain (sendBeacon), ≤ 8 KB. 204 on success and when the rev guard skips the write. */
export const CheckpointBody = z
  .object({
    rev: z.number().int().min(1),
    moves: z.array(Uci).max(BOT_GAME_MAX_MOVES),
    clocksMs: z.array(z.number().int().min(0)).max(BOT_GAME_MAX_MOVES),
    assists: Assists,
  })
  .refine(clocksMatchMoves, CLOCKS_ISSUE);
export type CheckpointBody = z.infer<typeof CheckpointBody>;

export const CompleteResult = z.enum(["w", "b", "draw", "aborted"]);
export type CompleteResult = z.infer<typeof CompleteResult>;

/** ≤ 16 KB. The server adjudicates (§8.16): board-verifiable endings must match the moves. */
export const CompleteBody = z
  .object({
    rev: z.number().int().min(0),
    moves: z.array(Uci).max(BOT_GAME_MAX_MOVES),
    clocksMs: z.array(z.number().int().min(0)).max(BOT_GAME_MAX_MOVES),
    result: CompleteResult,
    method: EndMethod,
    assists: Assists,
    /** Client epoch ms (informational; the server stamps endedAt). */
    endedAtClient: z.number().int().min(0),
  })
  .refine(clocksMatchMoves, CLOCKS_ISSUE);
export type CompleteBody = z.infer<typeof CompleteBody>;

/**
 * The analysis seed of a finished game (phase-03 §5.8): the game-over card writes it into `qk.review.status(ref)`.
 * A fresh finish answers `queued` (≥ 6 plies) or `skipped` (shorter, or aborted); an idempotent replay answers the
 * game's current `analysisStatus` (`none` for a game finished before P3, or any later state).
 */
export const CompleteAnalysis = z.object({
  status: AnalysisStatusWire,
  /** Seconds until the review is likely ready; null when not queued. */
  etaSec: z.number().int().min(0).nullable(),
});
export type CompleteAnalysis = z.infer<typeof CompleteAnalysis>;

/** 200. An already finished game answers its stored result with `Idempotent-Replayed: true`. */
export const CompleteResponse = z.object({
  status: z.enum(["COMPLETED", "ABORTED"]),
  outcome: z.enum(["WHITE", "BLACK", "DRAW", "NONE"]),
  method: EndMethod,
  analysis: CompleteAnalysis,
  /**
   * The legend block of a legend-bot game (§4.7), from the facts the same `complete` writes (P3-D24); null for every
   * other game.
   */
  comparison: LegendSummaryDTO.nullable(),
});
export type CompleteResponse = z.infer<typeof CompleteResponse>;

/** `GET /api/games/[ref]/pgn` body: PGN text (`text/x-chess-pgn`), attachment, `private, no-store`. */
export const PgnText = z.string();

// ── G1 `GET /api/me/games` (phase-03 §5.10, §7.1, §9.3; keyset on `game_players."endedAt"`, P3-D25) ─────────────
export const GameResultFilter = z.enum(GAME_RESULT_FILTERS);
export type GameResultFilter = z.infer<typeof GameResultFilter>;

export const GameTcFilter = z.enum(GAME_TC_FILTERS);
export type GameTcFilter = z.infer<typeof GameTcFilter>;

/** The wire query: csv lists as written in the URL (`?result=win,draw&tc=blitz`). Parse with gamesFilterOf(). */
export const GamesQuery = z.object({
  q: z.string().trim().max(GAMES_SEARCH_MAX).optional(),
  /** csv of win, loss, draw. */
  result: z.string().max(40).optional(),
  /** csv of bullet, blitz, rapid, classical. */
  tc: z.string().max(60).optional(),
  /** `1`/`true`: only games with moments to review. */
  moments: z.stringbool().optional(),
  cursor: CursorParam,
  /** 0 = counts only (`meta.filteredTotal`, `meta.counts`), no rows. */
  limit: z.coerce.number().int().min(0).max(GAMES_PAGE_LIMIT).default(GAMES_PAGE_LIMIT),
});
export type GamesQuery = z.infer<typeof GamesQuery>;

/** One archive row. Dates come from `game_players."endedAt"`; the label is rendered in `viewer.timeZone ?? "UTC"`. */
export const GameRowDTO = z.object({
  ref: Ref,
  color: Color,
  result: GameResultFilter,
  opponent: z.object({ name: z.string().min(1).max(120), rating: z.number().int().nullable(), kind: PlayerKind }),
  /** The review headline ("Missed Rxf5 · move 19"); null until done. */
  headline: z.string().max(80).nullable(),
  opening: Opening.nullable(),
  /** A legend or opening position's title, for games that started from one. */
  positionTitle: z.string().max(160).nullable(),
  tc: z.object({ label: z.string().max(40), timeClass: TimeClassWire.nullable() }),
  playedAt: IsoDateTime,
  playedAtLabel: z.string().max(40),
  /** P9 fills it; null in P3 (rendered "—"). */
  ratingDelta: z.number().int().nullable(),
  source: GameSourceWire,
  /** `games.fen`: the final position (the aside's static board). */
  finalFen: FenLoose,
  analysisStatus: AnalysisStatusWire,
  momentsCount: z.number().int().min(0).max(3),
  accuracy: z.number().int().min(0).max(100).nullable(),
  /** A legend game with a comparison row (the Compare button and the `C` key). */
  hasComparison: z.boolean(),
});
export type GameRowDTO = z.infer<typeof GameRowDTO>;

export const GamesListResponse = z.array(GameRowDTO).max(GAMES_PAGE_LIMIT);
export type GamesListResponse = z.infer<typeof GamesListResponse>;

/**
 * G1 `meta`. Page 1 (no cursor) and `limit=0` carry `filteredTotal` and `counts`; later pages only `nextCursor`
 * (AP-38). The cursor is opaque base64url `[1, endedAt ISO, gameId]` (cursor.ts).
 */
export const GamesPageMeta = z.object({
  nextCursor: z.string().nullable(),
  filteredTotal: z.number().int().min(0).optional(),
  counts: z.object({ all: z.number().int().min(0) }).optional(),
});
export type GamesPageMeta = z.infer<typeof GamesPageMeta>;
