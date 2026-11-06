// Client → server commands of protocol v2 (phase-02 plan §7.4.4). Every command is acked; the client gives up after
// ACK_TIMEOUT_MS. Ack: `{ ok: true, ...result } | { ok: false, code, message?, state?, retryAfterMs?, canOfferAtPly? }`.
// Inbound payloads are parsed with these schemas on the server; an invalid one is answered `{ ok: false, code:
// "internal" }` and counted as `ws.invalid_payload{event}` (§7.4.7). Unknown keys are stripped, not refused, so a
// client one release ahead of the server keeps working.
import { z } from "zod";
import { SocketErrorCode, type SocketErrorCode as SocketErrorCodeT } from "./codes";
import {
  ClientMoveId,
  DrawOfferInfo,
  GameState,
  LiveGameCard,
  LiveTimeClass,
  MoveAck,
  ReadyPair,
  Ref,
  Side,
  Uci,
} from "./game";
import { LIVE_LIST_MAX, MAX_GAME_PLIES, SOCKET_TOKEN_MAX_CHARS } from "./limits";

const EpochMs = z.number().int().min(0);

// ── Payloads ────────────────────────────────────────────────────────────────────────────────────────────────────
export const RefCommand = z.object({ ref: Ref });
export type RefCommand = z.infer<typeof RefCommand>;

export const GameJoinCommand = z.object({ ref: Ref, lastSeq: z.number().int().min(0).optional() });
export type GameJoinCommand = z.infer<typeof GameJoinCommand>;

/** `ply` = plies already played (the move becomes `ply + 1`). */
export const GameMoveCommand = z.object({
  ref: Ref,
  ply: z.number().int().min(0).max(MAX_GAME_PLIES),
  uci: Uci,
  clientMoveId: ClientMoveId,
  premove: z.boolean().optional(),
});
export type GameMoveCommand = z.infer<typeof GameMoveCommand>;

export const ClockPingCommand = z.object({ c: EpochMs });
export type ClockPingCommand = z.infer<typeof ClockPingCommand>;

export const LiveListCommand = z.object({ timeClass: LiveTimeClass.optional() });
export type LiveListCommand = z.infer<typeof LiveListCommand>;

export const RefreshTokenCommand = z.object({ token: z.string().min(1).max(SOCKET_TOKEN_MAX_CHARS) });
export type RefreshTokenCommand = z.infer<typeof RefreshTokenCommand>;

// ── Acks ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A negative ack. `state` comes with `stale_ply` and `illegal`; `canOfferAtPly` with `draw_cooldown`. */
export const AckError = z.object({
  ok: z.literal(false),
  code: SocketErrorCode,
  message: z.string().max(200).optional(),
  state: GameState.optional(),
  retryAfterMs: z.number().int().min(0).optional(),
  canOfferAtPly: z.number().int().min(0).optional(),
});
export type AckError = z.infer<typeof AckError>;

/** `{ ok: true, ...shape }`. */
function okAck<S extends z.ZodRawShape>(shape: S) {
  return z.object({ ok: z.literal(true), ...shape });
}

const EmptyOk = okAck({});

export const JoinPlayerOk = okAck({ role: z.literal("player"), color: Side, state: GameState });
export const JoinSpectatorOk = okAck({ role: z.literal("spectator"), state: GameState });
export const SyncOk = okAck({ state: GameState });
export const StudyReadyOk = okAck({ ready: ReadyPair });
export const MoveOk = okAck(MoveAck.shape);
/** `drawOffer` is null when the call accepted the opponent's open offer (the game ends with `agreement`). */
export const DrawOfferOk = okAck({ drawOffer: DrawOfferInfo.nullable() });
/** An open opponent offer turns `rematch:offer` into an accept, answered with `newRef`. */
export const RematchOfferOk = z.union([okAck({ expiresAt: EpochMs }), okAck({ newRef: Ref })]);
export const RematchAcceptOk = okAck({ newRef: Ref });
export const ClockPingOk = okAck({ c: EpochMs, s: EpochMs });
export const LiveListOk = okAck({ games: z.array(LiveGameCard).max(LIVE_LIST_MAX) });
/** `ent` = entitled-until of the new token (unix s). */
export const RefreshTokenOk = okAck({ ent: z.number().int().min(0) });

type RateSpec = { limit: number; windowMs: number } | null;

type CommandSpec = {
  payload: z.ZodType;
  ok: z.ZodType;
  /** Codes this command may answer with besides `internal` and `rate_limited` (every command can). */
  errors: readonly SocketErrorCodeT[];
  /** Per-command limit on top of the shared bucket (§7.4.8); null = bucket only. */
  rate: RateSpec;
};

function command<const P extends z.ZodType, const O extends z.ZodType>(spec: {
  payload: P;
  ok: O;
  errors: readonly SocketErrorCodeT[];
  rate: RateSpec;
}) {
  return { ...spec, ack: z.union([spec.ok, AckError]) };
}

/** The command table of §7.4.4. Keys are the wire names. */
export const COMMANDS = {
  "game:join": command({
    payload: GameJoinCommand,
    ok: JoinPlayerOk,
    errors: ["not_found", "forbidden", "draining"],
    rate: { limit: 5, windowMs: 10_000 },
  }),
  "spectate:join": command({
    payload: RefCommand,
    ok: z.union([JoinSpectatorOk, JoinPlayerOk]),
    errors: ["not_member", "forbidden", "not_found"],
    rate: { limit: 5, windowMs: 10_000 },
  }),
  "game:leave": command({ payload: RefCommand, ok: EmptyOk, errors: [], rate: null }),
  "game:sync": command({ payload: RefCommand, ok: SyncOk, errors: ["not_found"], rate: { limit: 2, windowMs: 1_000 } }),
  "study:ready": command({ payload: RefCommand, ok: StudyReadyOk, errors: ["phase"], rate: { limit: 2, windowMs: 1_000 } }),
  "game:move": command({
    payload: GameMoveCommand,
    ok: MoveOk,
    errors: ["phase", "ended", "not_your_turn", "stale_ply", "promotion_required", "illegal"],
    rate: { limit: 10, windowMs: 1_000 },
  }),
  "game:abort": command({ payload: RefCommand, ok: EmptyOk, errors: ["phase", "not_allowed"], rate: { limit: 1, windowMs: 1_000 } }),
  "game:resign": command({ payload: RefCommand, ok: EmptyOk, errors: ["phase", "ended"], rate: { limit: 1, windowMs: 1_000 } }),
  "draw:offer": command({ payload: RefCommand, ok: DrawOfferOk, errors: ["phase", "draw_cooldown"], rate: null }),
  "draw:accept": command({ payload: RefCommand, ok: EmptyOk, errors: ["no_offer"], rate: { limit: 2, windowMs: 1_000 } }),
  "draw:decline": command({ payload: RefCommand, ok: EmptyOk, errors: ["no_offer"], rate: { limit: 2, windowMs: 1_000 } }),
  "rematch:offer": command({
    payload: RefCommand,
    ok: RematchOfferOk,
    errors: ["not_allowed", "expired", "draining"],
    rate: null,
  }),
  "rematch:accept": command({
    payload: RefCommand,
    ok: RematchAcceptOk,
    errors: ["no_offer", "expired", "paywall", "not_member"],
    rate: { limit: 1, windowMs: 1_000 },
  }),
  "rematch:decline": command({ payload: RefCommand, ok: EmptyOk, errors: ["no_offer"], rate: { limit: 2, windowMs: 1_000 } }),
  "rematch:cancel": command({ payload: RefCommand, ok: EmptyOk, errors: ["no_offer"], rate: { limit: 2, windowMs: 1_000 } }),
  "clock:ping": command({ payload: ClockPingCommand, ok: ClockPingOk, errors: [], rate: { limit: 1, windowMs: 1_000 } }),
  "live:list": command({ payload: LiveListCommand, ok: LiveListOk, errors: ["not_member"], rate: { limit: 1, windowMs: 2_000 } }),
  "session:refresh_token": command({
    payload: RefreshTokenCommand,
    ok: RefreshTokenOk,
    errors: ["unauthorized"],
    rate: { limit: 1, windowMs: 10_000 },
  }),
} as const satisfies Record<string, CommandSpec & { ack: z.ZodType }>;

/** Rematch offers per game (not per time window): REMATCH_MAX_OFFERS in limits.ts. Draw offers: by cooldown. */
export type CommandName = keyof typeof COMMANDS;
export const COMMAND_NAMES = Object.keys(COMMANDS) as CommandName[];

/** What the client sends (before defaults). */
export type CommandPayload<N extends CommandName> = z.input<(typeof COMMANDS)[N]["payload"]>;
/** What the server works with after parsing. */
export type ParsedCommand<N extends CommandName> = z.output<(typeof COMMANDS)[N]["payload"]>;
export type CommandOk<N extends CommandName> = z.output<(typeof COMMANDS)[N]["ok"]>;
export type CommandAck<N extends CommandName> = CommandOk<N> | AckError;

/** socket.io typing for `Server<ClientToServerEvents>` and `Socket<…, ClientToServerEvents>`. */
export type ClientToServerEvents = {
  [N in CommandName]: (payload: CommandPayload<N>, ack: (response: CommandAck<N>) => void) => void;
};

export function isCommandName(value: unknown): value is CommandName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(COMMANDS, value);
}

/** Parses an inbound payload: `{ success, data }` or `{ success: false }` (the server then acks `internal`). */
export function parseCommand<N extends CommandName>(
  name: N,
  payload: unknown,
): { success: true; data: ParsedCommand<N> } | { success: false; error: z.ZodError } {
  const result = COMMANDS[name].payload.safeParse(payload);
  return result.success
    ? { success: true, data: result.data as ParsedCommand<N> }
    : { success: false, error: result.error };
}

/** Builds a negative ack. */
export function ackError(code: SocketErrorCodeT, extra: Omit<AckError, "ok" | "code"> = {}): AckError {
  return { ok: false, code, ...extra };
}
