// GET /internal/metrics (kid `ops`, or `web` for the P12 admin tile; phase-02 plan 7.5): a point-in-time view
// `{ sockets, games: { byPhase }, outbox: { depth, oldestMs }, loopLag: { p50, p99 }, rssMb, restored, bootId }`.
// Blocked at Caddy from outside.
import type { Express } from "express";
import type { Server } from "socket.io";
import type { MetricsResponse } from "@repo/contracts/socket/internal";
import type { SessionRegistry } from "../game/SessionRegistry";
import type { LoopLag } from "../obs/metrics";
import type { OutboxStats } from "../ports";
import { internalRoute, type InternalAuthDeps } from "./allow";

export interface MetricsRouteDeps extends InternalAuthDeps {
  io: Server;
  registry: SessionRegistry;
  loopLag: LoopLag;
  outbox(): OutboxStats;
  restored(): boolean;
  bootId: string;
}

export function gamesByPhase(registry: SessionRegistry): Record<string, number> {
  const byPhase: Record<string, number> = {};
  for (const s of registry.all()) {
    const key = s.state.frozen ? "frozen" : s.phase;
    byPhase[key] = (byPhase[key] ?? 0) + 1;
  }
  return byPhase;
}

export function metricsSnapshot(deps: Omit<MetricsRouteDeps, keyof InternalAuthDeps>): MetricsResponse {
  const o = deps.outbox();
  return {
    sockets: deps.io.engine?.clientsCount ?? 0,
    games: { byPhase: gamesByPhase(deps.registry) },
    outbox: { depth: o.depth, oldestMs: Math.round(o.oldestMs) },
    loopLag: { p50: deps.loopLag.p50(), p99: deps.loopLag.p99() },
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
    restored: deps.restored(),
    bootId: deps.bootId,
  };
}

export function mountMetrics(app: Express, deps: MetricsRouteDeps): void {
  app.get(
    "/internal/metrics",
    ...internalRoute(deps, "/internal/metrics", (_req, res) => {
      res.json(metricsSnapshot(deps));
    }),
  );
}
