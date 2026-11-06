// GET /health (phase-02 plan 7.5): liveness for the uptime monitor. 200 while the process is alive and the event
// loop lag is under 1 s, 503 otherwise. No auth, no database.
import type { Express } from "express";
import type { HealthResponse } from "@repo/contracts/socket/internal";
import type { LoopLag } from "../obs/metrics";

export const HEALTH_MAX_LOOP_LAG_MS = 1_000;

export function mountHealth(app: Express, deps: { loopLag: LoopLag; bootId: string }): void {
  app.get("/health", (_req, res) => {
    const loopLagMs = Math.round(deps.loopLag.current());
    const ok = loopLagMs < HEALTH_MAX_LOOP_LAG_MS;
    res.status(ok ? 200 : 503).json({ ok, loopLagMs, bootId: deps.bootId } satisfies HealthResponse & { bootId: string });
  });
}
