// The socket server, built without listening (phase-02 plan 7.4, 13.1 row D tasks D1–D3), so tests run it
// in-process on a random port. src/index.ts adds the real adapters, the signals and `listen`.
//
//   HTTP (express)  ── /health, /ready, /internal/* with HMAC (src/http/*), then the v1 static-token alias
//   socket.io       ── handshake (server/handshake.ts) ─┬─ proto 2 → commands/* over game/LiveSession (+ user room,
//                                                       │             session:hello, RTT watch, lobby events)
//                                                       └─ no proto, PROTOCOL_V1=on → src/v1 handlers (+ lobby events)
import express, { type Express } from "express";
import { createServer, type Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { ROOM } from "@repo/contracts/socket/rooms";
import {
  BROADCAST_NOTICE_MAX_S,
  BROADCAST_NOTICE_MIN_S,
  MAX_HTTP_BUFFER_BYTES,
  PING_INTERVAL_MS,
  PING_TIMEOUT_MS,
} from "@repo/contracts/socket/limits";
import { originAllowed, type ServerEnv } from "./config/env";
import { timingFor, type Timing } from "./config/timing";
import { registerCommands } from "./commands";
import { EntitlementStore, type CommandContext } from "./commands/context";
import { detachFrom } from "./commands/game";
import { SocketIndex, watchRtt } from "./game/presence";
import { SessionRegistry } from "./game/SessionRegistry";
import { mountHttp } from "./http";
import { TournamentManager } from "./legacy/TournamentManager";
import { createLoopLag, type LoopLag } from "./obs/metrics";
import { drainSessions } from "./persist/drain";
import {
  NOOP_METRICS,
  NOOP_TELEMETRY,
  createConsoleLogger,
  type LivePersistence,
  type Logger,
  type Metrics,
  type OutboxStats,
  type Telemetry,
} from "./ports";
import { createHandshake, releaseHandshake, type SocketData } from "./server/handshake";
import { DEFAULT_HANDSHAKE_LIMITS, HandshakeLimiter } from "./server/rateLimit";
import { UserRooms, newBootId } from "./server/rooms";
import { createV1Runtime, registerV1TournamentEventRoute, type V1Runtime, type V1RuntimeOptions } from "./v1/runtime";

export interface SocketServerOptions {
  env: ServerEnv;
  persistence: LivePersistence;
  log?: Logger;
  metrics?: Metrics;
  telemetry?: Telemetry;
  now?: () => number;
  /** Overrides the timing derived from `env` (tests). */
  timing?: Timing;
  /** Options of the v1 runtime (tests shorten its grace and study). */
  v1?: V1RuntimeOptions;
  /** Upper bound of the shutdown drain. Default 20 s (plan 7.6: ≤ 20 s inside stop_grace_period 30 s). */
  drainTimeoutMs?: number;
  /** Event-loop lag source for /health and /internal/metrics (default: a live monitor). */
  loopLag?: LoopLag;
  /**
   * False until the boot restore finished (`/ready` 503 meanwhile); src/boot.ts passes false and calls
   * `markRestored()`. Default true (in-memory tests have nothing to restore).
   */
  restored?: boolean;
  /** `POST /internal/drain`: run the SIGTERM path (index.ts drains and exits). Default: `shutdown()`. */
  onDrainRequested?: () => void;
  /** Test spy: `/internal/emit` is about to parse `data`. */
  onEmitParse?: (event: string) => void;
}

export interface SocketServerHandle {
  app: Express;
  httpServer: HttpServer;
  io: Server;
  env: ServerEnv;
  timing: Timing;
  bootId: string;
  bootAt: number;
  registry: SessionRegistry;
  index: SocketIndex;
  userRooms: UserRooms;
  ents: EntitlementStore;
  limiter: HandshakeLimiter;
  tournaments: TournamentManager;
  /** Null when PROTOCOL_V1 is off. */
  v1: V1Runtime | null;
  /** Event-loop lag (health, metrics push). */
  loopLag: LoopLag;
  /** True once the boot restore finished (`/ready`). */
  readonly restored: boolean;
  markRestored(): void;
  /** Outbox health from the persistence adapter (zeros for adapters without stats). */
  outboxStats(): OutboxStats;
  /**
   * The restart notice (plan 7.4.5 `server:restarting`, 5.7 B): no new sessions or rematches from now on, and every
   * game and spectate room hears `{restartAt, resumes: true}`. `POST /internal/broadcast` calls this.
   */
  announceRestart(inSeconds: number): { restartAt: number; rooms: number };
  /**
   * SIGTERM drain (plan 7.6): no new sessions, every running clock frozen, dirty games flushed (≤ drainTimeoutMs),
   * sockets closed. Idempotent.
   */
  shutdown(): Promise<void>;
  /** Listens on `port` (0 = random); resolves with the bound port. */
  listen(port: number, host?: string): Promise<number>;
}

export function createSocketServer(options: SocketServerOptions): SocketServerHandle {
  const { env, persistence } = options;
  const now = options.now ?? Date.now;
  const log = options.log ?? createConsoleLogger({ level: env.logLevel });
  const metrics = options.metrics ?? NOOP_METRICS;
  const telemetry = options.telemetry ?? NOOP_TELEMETRY;
  const timing = options.timing ?? timingFor(env);
  const drainTimeoutMs = options.drainTimeoutMs ?? 20_000;
  const bootAt = now();
  const bootId = newBootId();

  const loopLag = options.loopLag ?? createLoopLag();
  let restored = options.restored ?? true;
  const outboxStats = (): OutboxStats =>
    persistence.stats?.() ?? { depth: 0, oldestMs: 0, dbOkAt: null, lastFailAt: null };

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: env.allowedOrigins.length ? env.allowedOrigins : true, credentials: false },
    // Fails closed: an Origin that is not listed never upgrades (plan 7.4.1, 11.2 rule 8; loadEnv requires the
    // list in dev and production).
    allowRequest: (req, cb) => cb(null, originAllowed(env, req.headers.origin)),
    pingInterval: PING_INTERVAL_MS,
    pingTimeout: PING_TIMEOUT_MS,
    maxHttpBufferSize: MAX_HTTP_BUFFER_BYTES,
    perMessageDeflate: false,
    // No connectionStateRecovery: memory-only and useless across restarts; `game:sync` is the one resync path.
  });

  const limiter = new HandshakeLimiter({ ...DEFAULT_HANDSHAKE_LIMITS, ipGuardBootGraceMs: timing.ipGuardBootGraceMs }, bootAt);
  io.use(createHandshake({ env, limiter, now, log, metrics }));

  const index = new SocketIndex();
  const userRooms = new UserRooms(io, bootId);
  const ents = new EntitlementStore();
  const tournaments = new TournamentManager(io, log);
  const registry = new SessionRegistry({
    emit: (room, event, payload) => io.to(room).emit(event, payload),
    now,
    timing,
    persistence,
    telemetry,
    metrics,
    log,
    appEnv: env.appEnv,
    onFinished: (session, result) => {
      // Legacy arena lobby refresh, in-process (replaces chess/game-over's web → socket notify; plan 6.6.4).
      const t = session.ids.tournament;
      if (t) tournaments.emitGameEnded(t.ref, { gameReferenceId: session.ref, result: result.method });
    },
    onEvict: (ref) => index.forgetGame(ref),
  });
  registry.start();
  // Idle per-user/per-IP rate windows are dropped every sweep (memory only).
  const limiterPrune = setInterval(() => limiter.prune(now()), timing.evictEveryMs);
  limiterPrune.unref();

  const v1 = env.protocolV1 ? createV1Runtime(options.v1) : null;

  const ctx: CommandContext = { io, env, timing, registry, index, userRooms, ents, now, log, metrics };

  io.on("connection", (socket) => {
    const data = socket.data as SocketData;
    void socket.join(ROOM.user(data.userRef));
    if (data.proto === 2 || data.ent > ctx.ents.get(data.userRef)) ents.set(data.userRef, data.ent);
    tournaments.attach(socket);

    if (data.proto === 1 && v1) {
      v1.attach(socket);
    } else {
      registerCommands(socket, ctx);
      watchRtt(socket, now, (rttMs) => {
        metrics.sample("ws.client_rtt_ms", rttMs);
        for (const [ref, side] of index.playerGames(socket.id)) {
          registry.get(ref)?.dispatch({ type: "ping", side, rttMs });
        }
      });
      socket.emit("session:hello", { bootId, useq: userRooms.current(data.userRef), serverNow: now() });
    }

    socket.on("disconnect", (reason) => {
      releaseHandshake(limiter, data);
      metrics.count("ws.disconnect", { reason, proto: data.proto });
      for (const ref of index.refsOf(socket.id)) detachFrom(ctx, socket, ref);
    });
  });

  let restartAt: number | null = null;
  const announceRestart = (inSeconds: number): { restartAt: number; rooms: number } => {
    const seconds = Math.min(BROADCAST_NOTICE_MAX_S, Math.max(BROADCAST_NOTICE_MIN_S, Math.round(inSeconds)));
    restartAt = now() + seconds * 1000;
    registry.draining = true;
    const payload = { restartAt, resumes: true as const };
    let rooms = 0;
    for (const session of registry.all()) {
      io.to(ROOM.game(session.ref)).emit("server:restarting", payload);
      io.to(ROOM.spectate(session.ref)).emit("server:restarting", payload);
      rooms += 2;
    }
    log.info("restart announced", { inSeconds: seconds, rooms });
    return { restartAt, rooms };
  };

  let closing: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      clearInterval(limiterPrune);
      // A drain nobody announced (a bare SIGTERM: a manual container restart, a host reboot) still tells every game
      // it is a server restart before the sockets close, so players see "Server restarting" and the restart zone,
      // not a plain disconnect (D11). The deploy workflow's notice (`broadcast --in 30`) already did this.
      if (restartAt === null) {
        restartAt = now();
        const payload = { restartAt, resumes: true as const };
        for (const session of registry.all()) {
          io.to(ROOM.game(session.ref)).emit("server:restarting", payload);
          io.to(ROOM.spectate(session.ref)).emit("server:restarting", payload);
        }
        log.info("restart announced at drain", { rooms: registry.size * 2 });
      }
      await drainSessions({ registry, persistence, io, httpServer, v1, log, metrics, now, budgetMs: drainTimeoutMs });
      tournaments.destroy();
      v1?.destroy();
      if (!options.loopLag) loopLag.stop();
    })();
    return closing;
  };

  mountHttp({
    app,
    io,
    registry,
    userRooms,
    tournaments,
    internalKeys: env.internalKeys,
    appEnv: env.appEnv,
    legacyTournamentFallback: v1 !== null,
    bootId,
    bootAt,
    now,
    log,
    metrics,
    loopLag,
    outbox: outboxStats,
    restored: () => restored,
    draining: () => registry.draining,
    announceRestart,
    requestDrain: () => (options.onDrainRequested ? options.onDrainRequested() : void shutdown()),
    ...(options.onEmitParse ? { onEmitParse: options.onEmitParse } : {}),
  });
  if (v1) {
    // The static-token route lives only while v1 does (plan 7.5.1 "Never the static token"), after the signed one.
    registerV1TournamentEventRoute(app, tournaments);
  }

  const listen = (port: number, host?: string): Promise<number> =>
    new Promise((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(port, host, () => {
        httpServer.off("error", reject);
        const address = httpServer.address();
        resolve(typeof address === "object" && address ? address.port : port);
      });
    });

  return {
    app,
    httpServer,
    io,
    env,
    timing,
    bootId,
    bootAt,
    registry,
    index,
    userRooms,
    ents,
    limiter,
    tournaments,
    v1,
    loopLag,
    get restored() {
      return restored;
    },
    markRestored() {
      restored = true;
    },
    outboxStats,
    announceRestart,
    shutdown,
    listen,
  };
}
