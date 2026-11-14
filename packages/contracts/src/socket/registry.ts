// The server → client event registry (phase-02 plan §7.4.5, §7.5; api-perf §5 "name registry"). One name, one
// schema, for the whole socket protocol: the game events of events.ts plus the user-room events later phases emit
// through `/internal/emit` (P3 analysis:*, P4 import:*, P10 presence:state, …). A phase adds its events here.
//
// Only events in EMIT_EVENTS may be sent through `/internal/emit`, and only by a kid whose allow-list admits them
// (../internal/auth.ts INTERNAL_POLICY). Game-room events are emitted by the socket server itself and can never be
// injected over HTTP. P2 registers one emit event, `test:echo`, outside production; P3 the analysis events.
import { z } from "zod";
import { ANALYSIS_EVENTS, ANALYSIS_EVENT_BUDGETS, type AnalysisEventName } from "./analysis";
import { GAME_EVENTS, type GameEventName } from "./events";
import { eventBudget } from "./limits";
import type { RoomKind } from "./rooms";
import { USER_EVENTS, USER_EVENT_BUDGETS, type UserEventName } from "./user";

/** Where an event goes. `sender` = only the socket that caused it; `all-games` = every game and spectate room. */
export type EventRoute = RoomKind | "sender" | "all-games";

export type EventSpec = {
  readonly schema: z.ZodType;
  readonly to: readonly EventRoute[];
  /** Carries the per-room `seq`. */
  readonly seq: boolean;
  /** Serialised size budget in bytes (limits.ts). */
  readonly budget: number;
};

function spec(name: GameEventName, to: readonly EventRoute[], seq: boolean): EventSpec {
  return { schema: GAME_EVENTS[name], to, seq, budget: eventBudget(name) };
}

/** The game protocol (§7.4.5 table). */
export const GAME_EVENT_SPECS = {
  "game:snapshot": spec("game:snapshot", ["sender"], true),
  "game:phase": spec("game:phase", ["game", "spectate"], true),
  "study:ready": spec("study:ready", ["game"], true),
  "move:applied": spec("move:applied", ["game", "spectate"], true),
  "clock:sync": spec("clock:sync", ["game", "spectate"], true),
  "presence:update": spec("presence:update", ["game", "spectate"], true),
  "draw:offered": spec("draw:offered", ["game"], true),
  "draw:declined": spec("draw:declined", ["game"], true),
  "draw:cancelled": spec("draw:cancelled", ["game"], true),
  "game:ended": spec("game:ended", ["game", "spectate"], true),
  "game:result": spec("game:result", ["game"], true),
  "session:hello": spec("session:hello", ["sender"], false),
  "rematch:offered": spec("rematch:offered", ["game"], true),
  "rematch:declined": spec("rematch:declined", ["game"], true),
  "rematch:cancelled": spec("rematch:cancelled", ["game"], true),
  "rematch:expired": spec("rematch:expired", ["game"], true),
  "rematch:started": spec("rematch:started", ["game"], true),
  "spectators:update": spec("spectators:update", ["game", "spectate"], false),
  "game:error": spec("game:error", ["sender"], false),
  "server:restarting": spec("server:restarting", ["all-games"], false),
} as const satisfies Record<GameEventName, EventSpec>;

// ── Emit events (fan-out through POST /internal/emit) ───────────────────────────────────────────────────────────
/** Dev/test round-trip event for emit.int.test.ts and the post-deploy check. Refused when APP_ENV=production. */
export const TestEchoEvent = z.object({ text: z.string().max(200), at: z.number().int().min(0).optional() });
export type TestEchoEvent = z.infer<typeof TestEchoEvent>;

export type EmitEventSpec = EventSpec & {
  /** Refused by the socket server when APP_ENV=production. */
  readonly devOnly?: boolean;
};

/** A P3 analysis event (./analysis.ts): user rooms only, no per-room seq (the user room's `useq` orders them). */
function analysisSpec<N extends AnalysisEventName>(name: N) {
  return { schema: ANALYSIS_EVENTS[name], to: ["user"], seq: false, budget: ANALYSIS_EVENT_BUDGETS[name] } as const;
}

/** A P4 user event (./user.ts): user rooms only, no per-room seq (phase-04 §7.6). */
function userSpec<N extends UserEventName>(name: N) {
  return { schema: USER_EVENTS[name], to: ["user"], seq: false, budget: USER_EVENT_BUDGETS[name] } as const;
}

export const EMIT_EVENTS = {
  "test:echo": { schema: TestEchoEvent, to: ["user", "game", "spectate", "tournament"], seq: false, budget: 300, devOnly: true },
  // ── P3 server analysis (phase-03 plan §5.11, §7.4). Only the game's member players receive them. The web emits
  // `analysis:queued` (A3/A4) and the socket server emits `analysis:queued` + `games:changed` in-process after a finish;
  // the worker (kid `wk`) emits the rest. INTERNAL_POLICY limits `wk` to these domains.
  "analysis:queued": analysisSpec("analysis:queued"),
  "analysis:progress": analysisSpec("analysis:progress"),
  "analysis:writing": analysisSpec("analysis:writing"),
  "analysis:done": analysisSpec("analysis:done"),
  "analysis:failed": analysisSpec("analysis:failed"),
  "analysis:batch": analysisSpec("analysis:batch"),
  "compare:ready": analysisSpec("compare:ready"),
  "games:changed": analysisSpec("games:changed"),
  // ── P4 import and billing (phase-04 plan §7.6). The worker (kid `wk`, `import:*`) emits the import events; the web
  // (kid `web`) emits `entitlement:changed`. Imports and purges reuse P3's `games:changed`.
  "import:progress": userSpec("import:progress"),
  "import:finished": userSpec("import:finished"),
  "import:failed": userSpec("import:failed"),
  "entitlement:changed": userSpec("entitlement:changed"),
  // P5 (phase-05 plan §7.4): the Mistake Bank events off the analysis path.
  "bank:due_changed": userSpec("bank:due_changed"),
  "mistakes:added": userSpec("mistakes:added"),
} as const satisfies Record<string, EmitEventSpec>;

export type EmitEventName = keyof typeof EMIT_EVENTS;
export type EmitEventPayload<N extends EmitEventName> = z.output<(typeof EMIT_EVENTS)[N]["schema"]>;

/** Every server → client event. */
export const SERVER_EVENTS = { ...GAME_EVENT_SPECS, ...EMIT_EVENTS } as const;
export type ServerEventName = keyof typeof SERVER_EVENTS;
export type ServerEventPayload<N extends ServerEventName> = z.output<(typeof SERVER_EVENTS)[N]["schema"]>;
export const SERVER_EVENT_NAMES = Object.keys(SERVER_EVENTS) as ServerEventName[];

/**
 * Every event delivered to a `user:{ref}` room carries `useq`, the user's per-process counter (§7.4.1 step 6); the
 * socket server adds it to `data` on delivery. A client that sees a `useq` gap (or a new `bootId` in
 * `session:hello`) refetches the user-level queries.
 */
export const UseqStamp = z.object({ useq: z.number().int().min(1) });
export type WithUseq<T> = T & { useq: number };

/** socket.io typing for `Server<…, ServerToClientEvents>` and the client socket. */
export type ServerToClientEvents = {
  [N in ServerEventName]: (payload: ServerEventPayload<N>) => void;
};

export function isServerEventName(value: unknown): value is ServerEventName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SERVER_EVENTS, value);
}

export function isEmitEventName(value: unknown): value is EmitEventName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(EMIT_EVENTS, value);
}

/**
 * Looks up an emit event for `/internal/emit`: `unknown` (→ 422) when it is not registered or is dev-only in
 * production; otherwise its schema (parse `data` with it after dropping empty-room targets).
 */
export function emitEventFor(
  event: string,
  appEnv: string,
): { ok: true; name: EmitEventName; schema: z.ZodType } | { ok: false; reason: "unknown" } {
  if (!isEmitEventName(event)) return { ok: false, reason: "unknown" };
  const entry: EmitEventSpec = EMIT_EVENTS[event];
  if (entry.devOnly && appEnv === "production") return { ok: false, reason: "unknown" };
  return { ok: true, name: event, schema: entry.schema };
}
