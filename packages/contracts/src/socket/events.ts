// Server → client events of protocol v2 (phase-02 plan §7.4.5). Every event in `game:{ref}` and `spectate:{ref}`
// carries `seq` (+1 per event per room) and `ref`; the client calls `game:sync` on a gap. `spectators:update`,
// `game:error`, `server:restarting` and `session:hello` carry no `seq`. Room routing and size budgets are in
// registry.ts and limits.ts.
import { z } from "zod";
import { GameResultReview } from "./analysis";
import { SocketErrorCode } from "./codes";
import { AbortedBy, Clocks, EndMethod, GameState, MoveApplied, Phase, ReadyPair, Ref, Side } from "./game";

const EpochMs = z.number().int().min(0);
const Seq = z.number().int().min(0);

export const GameSnapshotEvent = GameState;

export const GamePhaseEvent = z.object({
  seq: Seq,
  ref: Ref,
  phase: Phase,
  study: z.object({ endsAt: EpochMs, ready: ReadyPair }).optional(),
  firstMove: z.object({ side: Side, deadlineAt: EpochMs }).optional(),
  clocks: Clocks,
});
export type GamePhaseEvent = z.infer<typeof GamePhaseEvent>;

export const StudyReadyEvent = z.object({ seq: Seq, ref: Ref, side: Side });
export type StudyReadyEvent = z.infer<typeof StudyReadyEvent>;

export const MoveAppliedEvent = MoveApplied;
export type MoveAppliedEvent = z.infer<typeof MoveAppliedEvent>;

export const ClockSyncEvent = z.object({
  seq: Seq,
  ref: Ref,
  clocks: Clocks,
  frozen: z.object({ since: EpochMs, reason: z.literal("restart") }).optional(),
});
export type ClockSyncEvent = z.infer<typeof ClockSyncEvent>;

export const PresenceUpdateEvent = z.object({
  seq: Seq,
  ref: Ref,
  side: Side,
  online: z.boolean(),
  graceEndsAt: EpochMs.optional(),
});
export type PresenceUpdateEvent = z.infer<typeof PresenceUpdateEvent>;

export const DrawOfferedEvent = z.object({ seq: Seq, ref: Ref, by: Side });
export type DrawOfferedEvent = z.infer<typeof DrawOfferedEvent>;

/** `implicit`: the offer was declined by moving instead of pressing Decline. */
export const DrawDeclinedEvent = z.object({
  seq: Seq,
  ref: Ref,
  by: Side,
  canOfferAtPly: z.number().int().min(0),
  implicit: z.boolean(),
});
export type DrawDeclinedEvent = z.infer<typeof DrawDeclinedEvent>;

export const DrawCancelledEvent = z.object({ seq: Seq, ref: Ref });
export type DrawCancelledEvent = z.infer<typeof DrawCancelledEvent>;

/** Sent immediately on the end, before persistence. `rated` is always false in P2 (P9 rates games). */
export const GameEndedEvent = z.object({
  seq: Seq,
  ref: Ref,
  winner: Side.nullable(),
  method: EndMethod,
  ply: z.number().int().min(0),
  endedAt: EpochMs,
  finalFen: z.string().max(100),
  clocks: Clocks,
  rated: z.boolean(),
  /** Aborted games only (method `aborted`). */
  abortedBy: AbortedBy.optional(),
});
export type GameEndedEvent = z.infer<typeof GameEndedEvent>;

/**
 * After `finishGame()` committed. P9 fills `ratings`, P12 `tournament`. `review` (P3, CON 3.9) is the game-over card's
 * analysis seed: `queued` (≥ 6 plies: the finish statement enqueued the job) with an ETA, or `skipped` (shorter).
 */
export const GameResultEvent = z.object({
  seq: Seq,
  ref: Ref,
  ratings: z.null(),
  tournament: z.null(),
  review: GameResultReview,
});
export type GameResultEvent = z.infer<typeof GameResultEvent>;

/** Once per connect (§7.4.1 step 6): `bootId` per process start, `useq` = the user's last user-room event number. */
export const SessionHelloEvent = z.object({
  bootId: z.string().regex(/^[A-Za-z0-9_-]{6,32}$/),
  useq: z.number().int().min(0),
  serverNow: EpochMs,
});
export type SessionHelloEvent = z.infer<typeof SessionHelloEvent>;

export const RematchOfferedEvent = z.object({
  seq: Seq,
  ref: Ref,
  by: Side,
  expiresAt: EpochMs,
  /** The colour the receiver would play in the new game. */
  youPlay: Side.optional(),
});
export type RematchOfferedEvent = z.infer<typeof RematchOfferedEvent>;

export const RematchDeclinedEvent = z.object({ seq: Seq, ref: Ref, by: Side });
export type RematchDeclinedEvent = z.infer<typeof RematchDeclinedEvent>;

export const RematchCancelledEvent = z.object({ seq: Seq, ref: Ref, by: Side });
export type RematchCancelledEvent = z.infer<typeof RematchCancelledEvent>;

export const RematchExpiredEvent = z.object({
  seq: Seq,
  ref: Ref,
  by: Side,
  reason: z.enum(["timeout", "left"]),
});
export type RematchExpiredEvent = z.infer<typeof RematchExpiredEvent>;

/** `colors` holds user refs of the new game. */
export const RematchStartedEvent = z.object({
  seq: Seq,
  ref: Ref,
  newRef: Ref,
  colors: z.object({ w: Ref, b: Ref }),
});
export type RematchStartedEvent = z.infer<typeof RematchStartedEvent>;

/** No `seq`; at most one per SPECTATORS_UPDATE_MIN_MS. */
export const SpectatorsUpdateEvent = z.object({ ref: Ref, count: z.number().int().min(0) });
export type SpectatorsUpdateEvent = z.infer<typeof SpectatorsUpdateEvent>;

export const GameErrorEvent = z.object({ ref: Ref, code: SocketErrorCode, message: z.string().max(200) });
export type GameErrorEvent = z.infer<typeof GameErrorEvent>;

export const ServerRestartingEvent = z.object({ restartAt: EpochMs, resumes: z.boolean() });
export type ServerRestartingEvent = z.infer<typeof ServerRestartingEvent>;

/** The game protocol events by wire name. Emit-only (`/internal/emit`) events live in registry.ts. */
export const GAME_EVENTS = {
  "game:snapshot": GameSnapshotEvent,
  "game:phase": GamePhaseEvent,
  "study:ready": StudyReadyEvent,
  "move:applied": MoveAppliedEvent,
  "clock:sync": ClockSyncEvent,
  "presence:update": PresenceUpdateEvent,
  "draw:offered": DrawOfferedEvent,
  "draw:declined": DrawDeclinedEvent,
  "draw:cancelled": DrawCancelledEvent,
  "game:ended": GameEndedEvent,
  "game:result": GameResultEvent,
  "session:hello": SessionHelloEvent,
  "rematch:offered": RematchOfferedEvent,
  "rematch:declined": RematchDeclinedEvent,
  "rematch:cancelled": RematchCancelledEvent,
  "rematch:expired": RematchExpiredEvent,
  "rematch:started": RematchStartedEvent,
  "spectators:update": SpectatorsUpdateEvent,
  "game:error": GameErrorEvent,
  "server:restarting": ServerRestartingEvent,
} as const;

export type GameEventName = keyof typeof GAME_EVENTS;
export type GameEventPayload<N extends GameEventName> = z.output<(typeof GAME_EVENTS)[N]>;
