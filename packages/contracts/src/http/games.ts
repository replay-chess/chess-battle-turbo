// HTTP contracts of the games area (phase-02 plan §7, §7.1.1–§7.1.5). Registry entries: registry/games.ts.
// The snapshot is the socket protocol's GameState plus the HTTP-only fields, so the RSC, `GET /api/games/[ref]` and
// the socket join ack carry one shape.
import { z } from "zod";
import { EndMethod, GameState } from "../socket/game";
import { Color, Ref, Uci } from "./common";

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

/** 200. An already finished game answers its stored result with `Idempotent-Replayed: true`. */
export const CompleteResponse = z.object({
  status: z.enum(["COMPLETED", "ABORTED"]),
  outcome: z.enum(["WHITE", "BLACK", "DRAW", "NONE"]),
  method: EndMethod,
  /** P3 answers `queued`. */
  analysis: z.object({ status: z.enum(["none"]) }),
});
export type CompleteResponse = z.infer<typeof CompleteResponse>;

/** `GET /api/games/[ref]/pgn` body: PGN text (`text/x-chess-pgn`), attachment, `private, no-store`. */
export const PgnText = z.string();
