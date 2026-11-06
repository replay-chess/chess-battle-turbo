// Types shared by the server machine, the client reducer and the local runner.
// The wire shapes (GameState, MoveApplied, MoveAck and the event payloads) mirror phase-02 plan 7.4.6, which
// @repo/contracts/socket/game.ts (WP-C) defines in zod. game-core keeps plain TypeScript copies so it has no
// zod or contracts dependency; contracts' schema test asserts the two stay assignable (request to WP-C).

export type Side = "w" | "b";
export type Phase = "waiting" | "study" | "first_move" | "playing" | "ended";
export type EndMethod =
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
export type GameMode = "BOT" | "FRIEND" | "ONLINE" | "TOURNAMENT";
export type WireTimeClass = "bullet" | "blitz" | "rapid" | "classical" | "untimed";
export type AbortedBy = Side | "timeout" | "stale";

export const END_METHODS: readonly EndMethod[] = [
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
];

/** Milliseconds; `at` = server epoch ms at which the values were taken; the `run` side counts down from `at`. */
export interface Clocks {
  w: number;
  b: number;
  run: Side | null;
  at: number;
}

export interface PlayerView {
  ref: string | null;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  rating: number | null;
  isBot: boolean;
  online: boolean;
  graceEndsAt: number | null;
  ready?: boolean;
}

export interface PositionCard {
  name: string;
  event: string | null;
  year: number | null;
  sideToMove: Side;
  afterLabel: string | null;
  legendSide: Side | null;
}

export interface Prefix {
  /** Space-separated SAN played before `startFen` ("Game starts here"). */
  sans: string;
  startMoveNo: number;
  startsBlack: boolean;
}

export interface GameResult {
  winner: Side | null;
  method: EndMethod;
  ply: number;
  endedAt: number;
  /** Aborted games only: who aborted (copy "Game aborted by martin_k"). WP-B addition, request to WP-C. */
  abortedBy?: AbortedBy;
}

export interface GameState {
  v: 2;
  ref: string;
  seq: number;
  serverNow: number;
  mode: GameMode;
  rated: boolean;
  timeClass: WireTimeClass;
  tc: { initialMs: number; incrementMs: number; label: string } | null;
  header: { left: string; right: string };
  position: PositionCard | null;
  startFen: string;
  startPly: number;
  prefix: Prefix;
  /** Space-separated UCI from `startFen`. */
  moves: string;
  /** Mover's remaining ms after each ply. Empty for untimed games. */
  clocksMs: number[];
  fen: string;
  turn: Side;
  inCheck: boolean;
  phase: Phase;
  study: { endsAt: number; ready: { w: boolean; b: boolean } } | null;
  firstMove: { side: Side; deadlineAt: number } | null;
  clocks: Clocks;
  frozen: { since: number; reason: "restart" } | null;
  players: { w: PlayerView; b: PlayerView };
  you: { role: "player" | "spectator"; color?: Side };
  drawOffer: { by: Side; ply: number } | null;
  canOfferAtPly: { w: number; b: number };
  rematch: { by: Side; expiresAt: number; offersUsed: number } | null;
  spectators: number;
  result: GameResult | null;
  bot?: { elo: number; name: string };
  /** Present on rematch games (plan 4.3 `rematch_*`); not in the plan-7.4.6 list, added by WP-B (request to WP-C). */
  rematchOf?: string;
}

export interface MoveApplied {
  seq: number;
  ref: string;
  ply: number;
  uci: string;
  san: string;
  by: Side;
  clocks: Clocks;
  check?: true;
  premove?: true;
  drawOfferCleared?: true;
}

export interface MoveAck {
  seq: number;
  ply: number;
  san: string;
  clocks: Clocks;
  clientMoveId: string;
}

// ── Server → client event payloads (plan 7.4.5) ──
export interface PhaseEvent {
  seq: number;
  ref: string;
  phase: Phase;
  study?: { endsAt: number; ready: { w: boolean; b: boolean } };
  firstMove?: { side: Side; deadlineAt: number };
  clocks: Clocks;
}
export interface StudyReadyEvent {
  seq: number;
  ref: string;
  side: Side;
}
export interface ClockSyncEvent {
  seq: number;
  ref: string;
  clocks: Clocks;
  frozen?: { since: number; reason: "restart" };
}
export interface PresenceEvent {
  seq: number;
  ref: string;
  side: Side;
  online: boolean;
  graceEndsAt?: number;
}
export interface DrawOfferedEvent {
  seq: number;
  ref: string;
  by: Side;
}
export interface DrawDeclinedEvent {
  seq: number;
  ref: string;
  by: Side;
  canOfferAtPly: number;
  implicit: boolean;
}
export interface DrawCancelledEvent {
  seq: number;
  ref: string;
}
export interface GameEndedEvent {
  seq: number;
  ref: string;
  winner: Side | null;
  method: EndMethod;
  ply: number;
  endedAt: number;
  finalFen: string;
  clocks: Clocks;
  rated: false;
  /** Aborted games only (WP-B addition, request to WP-C). */
  abortedBy?: AbortedBy;
}
export interface GameResultEvent {
  seq: number;
  ref: string;
  ratings: null;
  tournament: null;
  review: { status: "none" };
}
export interface RematchEvent {
  seq: number;
  ref: string;
  by: Side;
  expiresAt?: number;
  youPlay?: Side;
}
export interface RematchExpiredEvent extends RematchEvent {
  reason: "timeout" | "left";
}
export interface RematchStartedEvent {
  seq: number;
  ref: string;
  newRef: string;
  colors: { w: string; b: string };
}
export interface SpectatorsEvent {
  ref: string;
  count: number;
}
export interface GameErrorEvent {
  ref: string;
  code: string;
  message: string;
}
export interface RestartingEvent {
  restartAt: number;
  resumes: true;
}

/** Every server event as a discriminated union on the socket event name. */
export type ServerEvent =
  | { name: "game:snapshot"; payload: GameState }
  | { name: "game:phase"; payload: PhaseEvent }
  | { name: "study:ready"; payload: StudyReadyEvent }
  | { name: "move:applied"; payload: MoveApplied }
  | { name: "clock:sync"; payload: ClockSyncEvent }
  | { name: "presence:update"; payload: PresenceEvent }
  | { name: "draw:offered"; payload: DrawOfferedEvent }
  | { name: "draw:declined"; payload: DrawDeclinedEvent }
  | { name: "draw:cancelled"; payload: DrawCancelledEvent }
  | { name: "game:ended"; payload: GameEndedEvent }
  | { name: "game:result"; payload: GameResultEvent }
  | { name: "rematch:offered"; payload: RematchEvent }
  | { name: "rematch:declined"; payload: RematchEvent }
  | { name: "rematch:cancelled"; payload: RematchEvent }
  | { name: "rematch:expired"; payload: RematchExpiredEvent }
  | { name: "rematch:started"; payload: RematchStartedEvent }
  | { name: "spectators:update"; payload: SpectatorsEvent }
  | { name: "game:error"; payload: GameErrorEvent }
  | { name: "server:restarting"; payload: RestartingEvent };

export type ServerEventName = ServerEvent["name"];

/** Ack error codes (plan 7.4.7). */
export type SocketErrorCode =
  | "unauthorized"
  | "not_member"
  | "paywall"
  | "forbidden"
  | "not_found"
  | "phase"
  | "ended"
  | "not_your_turn"
  | "illegal"
  | "promotion_required"
  | "stale_ply"
  | "no_offer"
  | "draw_cooldown"
  | "not_allowed"
  | "expired"
  | "rate_limited"
  | "draining"
  | "internal";

export type AckError = {
  ok: false;
  code: SocketErrorCode;
  message?: string;
  state?: GameState;
  retryAfterMs?: number;
  canOfferAtPly?: number;
};
export type Ack<T extends object = Record<never, never>> = ({ ok: true } & T) | AckError;

export const otherSide = (s: Side): Side => (s === "w" ? "b" : "w");
