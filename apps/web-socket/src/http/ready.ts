// GET /ready (phase-02 plan 7.5): the compose healthcheck and the deploy's readiness poll. 503 while draining,
// before the boot restore finished, when the oldest unflushed change is older than 60 s, or when no DB statement
// succeeded in the last 5 min while games are live and writes are failing. It never probes the database itself:
// a probe while idle would keep the Neon compute awake (plan 7.7).
import type { Express } from "express";
import type { ReadyResponse } from "@repo/contracts/socket/internal";
import type { OutboxStats } from "../ports";

export const READY_MAX_OUTBOX_AGE_MS = 60_000;
export const READY_MAX_DB_SILENCE_MS = 5 * 60_000;

export interface ReadyDeps {
  now(): number;
  bootAt: number;
  draining(): boolean;
  restored(): boolean;
  outbox(): OutboxStats;
  /** Sessions in study, first_move or playing. */
  liveGames(): number;
}

export function readiness(deps: ReadyDeps): ReadyResponse {
  const o = deps.outbox();
  const now = deps.now();
  const draining = deps.draining();
  const restored = deps.restored();
  const lastOk = o.dbOkAt ?? deps.bootAt;
  // "No DB write succeeded in the last 5 min while games are live": only while writes are being attempted and failing.
  const dbStuck =
    deps.liveGames() > 0 && o.lastFailAt !== null && o.lastFailAt > (o.dbOkAt ?? 0) && now - lastOk > READY_MAX_DB_SILENCE_MS;
  const ready = !draining && restored && o.oldestMs <= READY_MAX_OUTBOX_AGE_MS && !dbStuck;
  return { ready, draining, restored, outboxOldestMs: Math.round(o.oldestMs), dbOkAt: o.dbOkAt };
}

export function mountReady(app: Express, deps: ReadyDeps): void {
  app.get("/ready", (_req, res) => {
    const body = readiness(deps);
    res.status(body.ready ? 200 : 503).json(body);
  });
}
