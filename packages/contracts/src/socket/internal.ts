// Bodies and responses of the socket server's HTTP endpoints (phase-02 plan §7.5). Every `/internal/*` request is
// signed with ../internal/auth.ts. Request bodies are strict: an unknown key is a 400, so the retired `{ room }` and
// `rooms[]` emit shapes can never be half-accepted (consistency R-07).
import { z } from "zod";
import { Ref } from "../http/common";
import { BROADCAST_NOTICE_MAX_S, BROADCAST_NOTICE_MIN_S, EMIT_MAX_TARGETS } from "./limits";
import { RoomNameSchema } from "./rooms";

// ── POST /internal/emit ─────────────────────────────────────────────────────────────────────────────────────────
/** One target: a room built with ROOM, or a user (→ ROOM.user(userRef)). */
export const EmitTarget = z.union([z.strictObject({ room: RoomNameSchema }), z.strictObject({ userRef: Ref })]);
export type EmitTarget = z.infer<typeof EmitTarget>;

/**
 * The only emit body shape (B20 `targets[]`). `event` must be in the emit registry (registry.ts) and in the caller
 * kid's allow-list; `data` is parsed against the event's schema only after empty-room targets are dropped (AP-10).
 */
export const EmitBody = z.strictObject({
  v: z.literal(1),
  targets: z.array(EmitTarget).min(1).max(EMIT_MAX_TARGETS),
  event: z.string().regex(/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/).max(64),
  data: z.unknown(),
  /** Remembered EMIT_DEDUPE_TTL_MS; a repeat is answered 202 without a second delivery. */
  dedupeKey: z.string().min(1).max(120).optional(),
});
export type EmitBody = z.infer<typeof EmitBody>;

/** 202. `delivered` = targets that had at least one socket. */
export const EmitResponse = z.object({ delivered: z.number().int().min(0), deduped: z.boolean().optional() });
export type EmitResponse = z.infer<typeof EmitResponse>;

// ── POST /internal/broadcast, /internal/drain (kid ops) ─────────────────────────────────────────────────────────
export const BroadcastBody = z.strictObject({
  v: z.literal(1),
  type: z.literal("restart"),
  inSeconds: z.number().int().min(BROADCAST_NOTICE_MIN_S).max(BROADCAST_NOTICE_MAX_S),
});
export type BroadcastBody = z.infer<typeof BroadcastBody>;

export const BroadcastResponse = z.object({ restartAt: z.number().int(), rooms: z.number().int().min(0) });
export type BroadcastResponse = z.infer<typeof BroadcastResponse>;

export const DrainBody = z.strictObject({ v: z.literal(1) });
export type DrainBody = z.infer<typeof DrainBody>;

// ── POST /internal/tournament-event (legacy alias until P12) ────────────────────────────────────────────────────
export const LEGACY_TOURNAMENT_EVENTS = [
  "game_ended",
  "game_started",
  "tournament_started",
  "tournament_ended",
  "player_joined",
] as const;

/** The v1 body (`lib/services/tournament/notify-websocket.ts`); `data` is passed through to the lobby room. */
export const TournamentEventBody = z.object({
  event: z.enum(LEGACY_TOURNAMENT_EVENTS),
  tournamentReferenceId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  data: z.unknown().optional(),
});
export type TournamentEventBody = z.infer<typeof TournamentEventBody>;

// ── GET /internal/metrics (kid ops, or web for the P12 admin tile) ──────────────────────────────────────────────
export const MetricsResponse = z.object({
  sockets: z.number().int().min(0),
  games: z.object({ byPhase: z.record(z.string(), z.number().int().min(0)) }),
  outbox: z.object({ depth: z.number().int().min(0), oldestMs: z.number().int().min(0) }),
  loopLag: z.object({ p50: z.number().min(0), p99: z.number().min(0) }),
  rssMb: z.number().min(0),
  restored: z.boolean(),
  bootId: z.string(),
});
export type MetricsResponse = z.infer<typeof MetricsResponse>;

// ── GET /health, GET /ready (no auth) ───────────────────────────────────────────────────────────────────────────
export const HealthResponse = z.object({ ok: z.boolean(), loopLagMs: z.number().min(0) });
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ReadyResponse = z.object({
  ready: z.boolean(),
  draining: z.boolean(),
  restored: z.boolean(),
  outboxOldestMs: z.number().int().min(0),
  /** Epoch ms of the last successful DB write; null before the first. */
  dbOkAt: z.number().int().nullable(),
});
export type ReadyResponse = z.infer<typeof ReadyResponse>;

/** Error body of the socket server's HTTP endpoints (401 carries no detail). */
export const InternalErrorBody = z.object({
  error: z.object({ code: z.enum(["unauthorized", "forbidden", "validation_failed", "unknown_event", "invalid_data", "internal"]) }),
});
export type InternalErrorBody = z.infer<typeof InternalErrorBody>;
