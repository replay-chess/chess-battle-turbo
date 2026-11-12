// The socket server's HTTP surface (phase-02 plan 7.5): /health and /ready (no auth) and the signed /internal/*
// endpoints. Mounted by createSocketServer before the v1 static-token route, so a signed tournament event never
// reaches it.
import type { Express } from "express";
import type { Server } from "socket.io";
import { ReplayGuard, type KeyRing } from "@repo/contracts/internal/auth";
import type { SessionRegistry } from "../game/SessionRegistry";
import type { TournamentManager } from "../legacy/TournamentManager";
import type { LoopLag } from "../obs/metrics";
import type { Logger, Metrics, OutboxStats } from "../ports";
import type { UserRooms } from "../server/rooms";
import { mountBroadcast } from "./broadcast";
import { mountDrain } from "./drain";
import { mountEmit } from "./emit";
import { mountHealth } from "./health";
import { mountLoad } from "./load";
import { mountMetrics } from "./metrics";
import { mountReady } from "./ready";
import { mountTournamentEvent } from "./tournamentEvent";

export interface HttpDeps {
  app: Express;
  io: Server;
  registry: SessionRegistry;
  userRooms: UserRooms;
  tournaments: TournamentManager;
  internalKeys: KeyRing;
  appEnv: string;
  legacyTournamentFallback: boolean;
  bootId: string;
  bootAt: number;
  now(): number;
  log: Logger;
  metrics: Metrics;
  loopLag: LoopLag;
  /** P3 `/internal/load`: a lag monitor windowed per probe (reset on every read). */
  loadLag: LoopLag;
  outbox(): OutboxStats;
  restored(): boolean;
  draining(): boolean;
  announceRestart(inSeconds: number): { restartAt: number; rooms: number };
  requestDrain(): void;
  /** Test spy for `/internal/emit` (the data parse). */
  onEmitParse?(event: string): void;
}

const LIVE_PHASES = new Set(["study", "first_move", "playing"]);

export function mountHttp(deps: HttpDeps): void {
  const { app } = deps;
  const auth = { keys: deps.internalKeys, replay: new ReplayGuard(), now: deps.now, metrics: deps.metrics, log: deps.log };
  const liveGames = () => {
    let n = 0;
    for (const s of deps.registry.all()) if (LIVE_PHASES.has(s.phase)) n++;
    return n;
  };
  mountHealth(app, { loopLag: deps.loopLag, bootId: deps.bootId });
  mountReady(app, {
    now: deps.now,
    bootAt: deps.bootAt,
    draining: deps.draining,
    restored: deps.restored,
    outbox: deps.outbox,
    liveGames,
  });
  mountEmit(app, {
    ...auth,
    io: deps.io,
    userRooms: deps.userRooms,
    appEnv: deps.appEnv,
    ...(deps.onEmitParse ? { onParse: deps.onEmitParse } : {}),
  });
  mountTournamentEvent(app, { ...auth, tournaments: deps.tournaments, legacyFallback: deps.legacyTournamentFallback });
  mountBroadcast(app, { ...auth, announceRestart: deps.announceRestart });
  mountDrain(app, { ...auth, requestDrain: deps.requestDrain });
  mountLoad(app, { ...auth, io: deps.io, loopLag: deps.loadLag, liveGames, draining: deps.draining });
  mountMetrics(app, {
    ...auth,
    io: deps.io,
    registry: deps.registry,
    loopLag: deps.loopLag,
    outbox: deps.outbox,
    restored: deps.restored,
    bootId: deps.bootId,
  });
}
