// Protocol v2 payload types (phase-02 plan §7.4.6). One schema per shape; the types are inferred from them.
// Times on the wire are epoch ms (server clock); `serverNow` and `clocks.at` let the client compute its offset.
// Server → client objects are not strict (readers ignore fields they do not know, so a newer server never breaks an
// older tab); booleans that are false are omitted where the plan says so (api-perf AP-16).
import { z } from "zod";
import { Color, FenLoose, Ref, Uci } from "../http/common";
import { DISPLAY_NAME_MAX, MAX_GAME_PLIES, MAX_PREFIX_PLIES } from "./limits";

const int = () => z.number().int();
const nonNeg = () => z.number().int().min(0);
/** Epoch ms. */
const EpochMs = z.number().int().min(0);

export { Ref, Uci };

export const Side = Color;
export type Side = z.infer<typeof Side>;

export const Phase = z.enum(["waiting", "study", "first_move", "playing", "ended"]);
export type Phase = z.infer<typeof Phase>;

/** 11 end methods (§0.2 `GameEndMethod`, lower-case on the wire). */
export const EndMethod = z.enum([
  "checkmate",
  "resignation",
  "timeout",
  "timeout_vs_insufficient",
  "stalemate",
  "threefold",
  "fifty_move",
  "insufficient_material",
  "agreement",
  "abandoned",
  "aborted",
]);
export type EndMethod = z.infer<typeof EndMethod>;

export const GameModeWire = z.enum(["BOT", "FRIEND", "ONLINE", "TOURNAMENT"]);
export type GameModeWire = z.infer<typeof GameModeWire>;

/** Display time class (§8.11). `untimed` is for bot games only. */
export const TimeClassWire = z.enum(["bullet", "blitz", "rapid", "classical", "untimed"]);
export type TimeClassWire = z.infer<typeof TimeClassWire>;

/** Time classes a spectator can filter `live:list` by. */
export const LiveTimeClass = z.enum(["bullet", "blitz", "rapid"]);
export type LiveTimeClass = z.infer<typeof LiveTimeClass>;

/** Remaining ms per side; `run` is the side whose clock runs (null = none); `at` = server epoch ms of the reading. */
export const Clocks = z.object({
  w: nonNeg(),
  b: nonNeg(),
  run: Side.nullable(),
  at: EpochMs,
});
export type Clocks = z.infer<typeof Clocks>;

export const Frozen = z.object({ since: EpochMs, reason: z.literal("restart") });
export type Frozen = z.infer<typeof Frozen>;

export const ReadyPair = z.object({ w: z.boolean(), b: z.boolean() });
export type ReadyPair = z.infer<typeof ReadyPair>;

export const StudyInfo = z.object({ endsAt: EpochMs, ready: ReadyPair });
export type StudyInfo = z.infer<typeof StudyInfo>;

export const FirstMoveInfo = z.object({ side: Side, deadlineAt: EpochMs });
export type FirstMoveInfo = z.infer<typeof FirstMoveInfo>;

export const PlayerView = z.object({
  ref: Ref.nullable(),
  displayName: z.string().min(1).max(DISPLAY_NAME_MAX),
  initials: z.string().max(3),
  avatarUrl: z.string().max(500).nullable(),
  rating: int().nullable(),
  isBot: z.boolean(),
  online: z.boolean(),
  graceEndsAt: EpochMs.nullable(),
  ready: z.boolean().optional(),
});
export type PlayerView = z.infer<typeof PlayerView>;

export const PositionCard = z.object({
  name: z.string().max(120),
  event: z.string().max(120).nullable(),
  year: int().nullable(),
  sideToMove: Side,
  afterLabel: z.string().max(40).nullable(),
  legendSide: Side.nullable(),
});
export type PositionCard = z.infer<typeof PositionCard>;

/** "Game starts here": the SAN moves played before `startFen`, space-separated like `moves`. */
export const Prefix = z.object({
  sans: z.string().max(MAX_PREFIX_PLIES * 8),
  startMoveNo: z.number().int().min(1),
  startsBlack: z.boolean(),
});
export type Prefix = z.infer<typeof Prefix>;

export const DrawOfferInfo = z.object({ by: Side, ply: nonNeg() });
export type DrawOfferInfo = z.infer<typeof DrawOfferInfo>;

export const RematchInfo = z.object({ by: Side, expiresAt: EpochMs, offersUsed: nonNeg() });
export type RematchInfo = z.infer<typeof RematchInfo>;

/** Who aborted an aborted game: a side, the first-move timer, or the stale sweep (copy "Game aborted by martin_k"). */
export const AbortedBy = z.enum(["w", "b", "timeout", "stale"]);
export type AbortedBy = z.infer<typeof AbortedBy>;

export const GameResultInfo = z.object({
  winner: Side.nullable(),
  method: EndMethod,
  ply: nonNeg(),
  endedAt: EpochMs,
  /** Aborted games only. */
  abortedBy: AbortedBy.optional(),
});
export type GameResultInfo = z.infer<typeof GameResultInfo>;

export const ViewerRole = z.enum(["player", "spectator"]);
export type ViewerRole = z.infer<typeof ViewerRole>;

/** Space-separated UCI moves ("e2e4 e7e5 …"); empty string before the first move. */
export const UciList = z
  .string()
  .max(MAX_GAME_PLIES * 6)
  .regex(/^(?:[a-h][1-8][a-h][1-8][qrbn]?(?: [a-h][1-8][a-h][1-8][qrbn]?)*)?$/);

/** The full, role-aware game snapshot (`game:join` / `spectate:join` / `game:sync` acks, `game:snapshot`, the RSC). */
export const GameState = z.object({
  v: z.literal(2),
  ref: Ref,
  seq: nonNeg(),
  serverNow: EpochMs,
  mode: GameModeWire,
  rated: z.boolean(),
  timeClass: TimeClassWire,
  /** null = untimed. `label` is "5+3". */
  tc: z.object({ initialMs: nonNeg(), incrementMs: nonNeg(), label: z.string().max(12) }).nullable(),
  /** "C41 · Philidor · Opera Game 1858" | "Blitz 5+3 · unrated". */
  header: z.object({ left: z.string().max(160), right: z.string().max(80) }),
  position: PositionCard.nullable(),
  startFen: FenLoose,
  startPly: nonNeg(),
  prefix: Prefix,
  /** Space-separated UCI; SAN is derived on the client. */
  moves: UciList,
  /** The mover's remaining ms after each ply. */
  clocksMs: z.array(nonNeg()).max(MAX_GAME_PLIES),
  fen: FenLoose,
  turn: Side,
  inCheck: z.boolean(),
  phase: Phase,
  study: StudyInfo.nullable(),
  firstMove: FirstMoveInfo.nullable(),
  clocks: Clocks,
  frozen: Frozen.nullable(),
  players: z.object({ w: PlayerView, b: PlayerView }),
  you: z.object({ role: ViewerRole, color: Side.optional() }),
  /** Players only (null for spectators). */
  drawOffer: DrawOfferInfo.nullable(),
  canOfferAtPly: z.object({ w: nonNeg(), b: nonNeg() }),
  /** Players only. */
  rematch: RematchInfo.nullable(),
  spectators: nonNeg(),
  result: GameResultInfo.nullable(),
  /** BOT games. */
  bot: z.object({ elo: int(), name: z.string().max(DISPLAY_NAME_MAX) }).optional(),
  /**
   * The game this one is a rematch of (`games.rematchOfId` as a ref); omitted otherwise. Not in the plan's sketch:
   * the rematch_study / rematch_first / rematch_your states (§4.3 #7–#9) need it after a reload (WP-C addition).
   */
  rematchOf: Ref.optional(),
});
export type GameState = z.infer<typeof GameState>;

/** `move:applied`, ≤ 200 B serialised. No `fen`, no `clientMoveId`; the three flags are omitted when false. */
export const MoveApplied = z.object({
  seq: nonNeg(),
  ref: Ref,
  /** The ply number of this move (1-based: the first move of the game is ply startPly + 1). */
  ply: z.number().int().min(1),
  uci: Uci,
  san: z.string().min(2).max(8),
  by: Side,
  clocks: Clocks,
  check: z.literal(true).optional(),
  premove: z.literal(true).optional(),
  drawOfferCleared: z.literal(true).optional(),
});
export type MoveApplied = z.infer<typeof MoveApplied>;

/** The client-chosen id of a move, echoed only in the mover's ack. */
export const ClientMoveId = z.string().regex(/^[A-Za-z0-9_-]{1,16}$/);
export type ClientMoveId = z.infer<typeof ClientMoveId>;

/** Ack result of `game:move` (to the mover only), ≤ 160 B with the ack's `ok: true`. */
export const MoveAck = z.object({
  seq: nonNeg(),
  ply: z.number().int().min(1),
  san: z.string().min(2).max(8),
  clocks: Clocks,
  clientMoveId: ClientMoveId,
});
export type MoveAck = z.infer<typeof MoveAck>;

/** One row of `live:list` (watchable games in `playing`). */
export const LiveGameCard = z.object({
  ref: Ref,
  mode: z.enum(["FRIEND", "ONLINE", "TOURNAMENT"]),
  timeClass: TimeClassWire,
  tcLabel: z.string().max(12),
  white: z.object({ name: z.string().max(DISPLAY_NAME_MAX), rating: int().nullable() }),
  black: z.object({ name: z.string().max(DISPLAY_NAME_MAX), rating: int().nullable() }),
  ply: nonNeg(),
  spectators: nonNeg(),
  startedAt: EpochMs,
});
export type LiveGameCard = z.infer<typeof LiveGameCard>;
