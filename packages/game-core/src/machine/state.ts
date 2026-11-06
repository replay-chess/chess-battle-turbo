// Server machine state, inputs and effects (plan 8.1). The socket's LiveSession owns one ServerGame per live game,
// feeds inputs through `reduce()`, sends the returned events to the rooms, acks the command, and runs the effects
// (journal, checkpoint, finish, abortPersist, createRematch, armTimer/clearTimer, track).

import type { ClockRules } from "../clock/clock";
import { DEFAULT_CLOCK_RULES } from "../clock/clock";
import {
  DRAW_COOLDOWN_PLIES,
  FIRST_MOVE_MS,
  FLAG_TIMER_SLACK_MS,
  GRACE_FLAPPING_DETACHES,
  GRACE_FLAPPING_WINDOW_MS,
  GRACE_FLAPPING_MS,
  GRACE_MS,
  MOVE_ACK_MEMORY,
  REMATCH_MAX_OFFERS,
  REMATCH_MS,
  RESUME_MAX_WAIT_MS,
} from "../constants";
import type { JournalLine } from "./journal";
import type {
  AbortedBy,
  Ack,
  Clocks,
  GameMode,
  GameResult,
  MoveAck,
  Phase,
  PositionCard,
  Prefix,
  ServerEvent,
  Side,
  SocketErrorCode,
  WireTimeClass,
} from "./types";

/** Timings the socket may scale under TIMING_PROFILE=fast (APP_ENV=test only). */
export interface MachineConfig {
  firstMoveMs: number;
  graceMs: number;
  graceFlappingMs: number;
  flapDetaches: number;
  flapWindowMs: number;
  rematchMs: number;
  rematchMaxOffers: number;
  resumeMaxWaitMs: number;
  drawCooldownPlies: number;
  flagSlackMs: number;
  /** Study length multiplier (1 = the stored `studySeconds`). */
  studyScale: number;
  clock: ClockRules;
  ackMemory: number;
}

export const DEFAULT_MACHINE_CONFIG: MachineConfig = {
  firstMoveMs: FIRST_MOVE_MS,
  graceMs: GRACE_MS,
  graceFlappingMs: GRACE_FLAPPING_MS,
  flapDetaches: GRACE_FLAPPING_DETACHES,
  flapWindowMs: GRACE_FLAPPING_WINDOW_MS,
  rematchMs: REMATCH_MS,
  rematchMaxOffers: REMATCH_MAX_OFFERS,
  resumeMaxWaitMs: RESUME_MAX_WAIT_MS,
  drawCooldownPlies: DRAW_COOLDOWN_PLIES,
  flagSlackMs: FLAG_TIMER_SLACK_MS,
  studyScale: 1,
  clock: DEFAULT_CLOCK_RULES,
  ackMemory: MOVE_ACK_MEMORY,
};

export interface Seat {
  /** User referenceId; null only for a side nobody joined yet. */
  ref: string | null;
  name: string;
  avatarUrl: string | null;
  rating: number | null;
}

export interface Presence {
  sockets: string[];
  graceEndsAt: number | null;
  /** Detach timestamps inside the flapping window. */
  detaches: number[];
}

export type TimerKind = "study_end" | "first_move_deadline" | "flag" | "grace" | "rematch" | "resume";

export interface ServerGame {
  v: 1;
  ref: string;
  mode: Exclude<GameMode, "BOT">;
  rated: boolean;
  timeClass: WireTimeClass;
  tc: { initialMs: number; incrementMs: number } | null;
  startFen: string;
  startPly: number;
  studySeconds: number;
  startKind: "initial" | "position" | "opening";
  headerLeft: string;
  position: PositionCard | null;
  prefix: Prefix;
  seats: { w: Seat; b: Seat };
  rematchOf: string | null;
  createdAt: number;
  startedAt: number | null;

  phase: Phase;
  /** Last seq sent to `game:{ref}`. */
  seq: number;
  /** Last seq sent to `spectate:{ref}`. */
  spectSeq: number;

  moves: string[];
  sans: string[];
  clocksMs: number[];
  spentMs: number[];
  fen: string;
  turn: Side;
  inCheck: boolean;

  study: { endsAt: number; ready: { w: boolean; b: boolean } } | null;
  firstMove: { side: Side; deadlineAt: number } | null;
  clocks: Clocks;
  frozen: { since: number; reason: "restart"; run: Side | null; resumeBy: number | null } | null;
  draining: boolean;

  presence: { w: Presence; b: Presence };
  rtt: { w: number; b: number };
  lagUsed: { w: number; b: number };

  drawOffer: { by: Side; ply: number } | null;
  canOfferAtPly: { w: number; b: number };
  rematch: { by: Side; expiresAt: number; creating: boolean } | null;
  rematchOffersUsed: number;
  /** A rematch was created; no further offers. */
  rematchDone: boolean;

  result: GameResult | null;
  abortedBy: AbortedBy | null;
  stats: { drawOffers: { w: number; b: number }; premoves: { w: number; b: number } };
  spectators: number;
  /** Spectator one-ply delay: the last ply, not yet sent to `spectate:{ref}`. */
  /** `at`: when that ply was played (spectator snapshots run the delayed clock from it). */
  withheld: { ply: number; uci: string; san: string; by: Side; w: number; b: number; check: boolean; at: number } | null;
  /** Recent move acks for duplicate `clientMoveId`s. */
  acks: { id: string; side: Side; ack: MoveAck }[];
  /** The deadline last handed to the socket (change detection for armTimer/clearTimer). */
  timer: { at: number; kind: TimerKind } | null;
}

export type MachineInput =
  | { type: "attach"; side: Side; socketId: string }
  | { type: "detach"; side: Side; socketId: string }
  | { type: "ready"; side: Side }
  | { type: "move"; side: Side; ply: number; uci: string; clientMoveId: string; premove?: boolean }
  | { type: "ping"; side: Side; rttMs: number }
  | { type: "abort"; side: Side }
  | { type: "resign"; side: Side }
  | { type: "drawOffer"; side: Side }
  | { type: "drawAccept"; side: Side }
  | { type: "drawDecline"; side: Side }
  /** `ent`: entitled-until (unix seconds) from each player's newest token; needed when the offer crosses an open one. */
  | { type: "rematchOffer"; side: Side; ent?: { w: number; b: number } }
  | { type: "rematchAccept"; side: Side; ent: { w: number; b: number } }
  | { type: "rematchDecline"; side: Side }
  | { type: "rematchCancel"; side: Side }
  /** Fired by the per-game timer; without `kind` every due deadline is processed. */
  | { type: "timer"; kind?: TimerKind }
  | { type: "freeze"; reason: "drain" | "restore" }
  | { type: "resume" }
  | { type: "rematchCreated"; newRef: string }
  | { type: "rematchFailed"; code?: SocketErrorCode }
  | { type: "spectators"; count: number };

export type RoomEvent = { room: "game" | "spectate"; event: ServerEvent };

export type TrackEvent = "game_started" | "game_ended" | "game_aborted" | "rematch_expired";

export type Effect =
  | { type: "journal"; line: JournalLine }
  | { type: "checkpoint"; reason: "move" | "phase" | "freeze" }
  | { type: "finish"; result: GameResult }
  | { type: "abortPersist"; result: GameResult; abortedBy: AbortedBy }
  | { type: "createRematch"; offeredBy: Side; acceptedBy: Side }
  | { type: "armTimer"; at: number; kind: TimerKind }
  | { type: "clearTimer" }
  | {
      type: "track";
      event: TrackEvent;
      side: Side;
      userRef: string | null;
      props: Record<string, string | number | boolean | null>;
    };

export interface ReduceResult {
  state: ServerGame;
  events: RoomEvent[];
  effects: Effect[];
  /**
   * The command's ack. Undefined for inputs that are not commands (attach, detach, timer, freeze, …) and for
   * `rematchAccept`, whose ack is the result of the later `rematchCreated` / `rematchFailed` input.
   */
  ack?: Ack<Record<string, unknown>>;
}
