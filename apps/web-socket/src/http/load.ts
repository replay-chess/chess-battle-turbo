// GET /internal/load (kid `wk` only; phase-03 plan §7.4, P3-D8): the analysis worker's lag-pause probe. The worker
// shares the dev VM with this server and asks, at most once a second between two searches, whether live games need
// the CPU: `{loopLagP99Ms, liveGames, sockets, draining}`. Served from memory (a lag monitor, the session registry,
// the engine's client count), no I/O. Docker network only: Caddy does not route /internal/load.
//
// The lag is a WINDOW: the p99 since the previous probe (this route resets its own monitor after each read). The
// metrics monitor cannot serve here: it is reset only by the 60 s Sentry push, which dev does not run, so its p99
// would cover everything since boot and a startup spike would pause the worker for good.
import type { Express } from "express";
import type { Server } from "socket.io";
import type { LoadResponse } from "@repo/contracts/socket/internal";
import type { LoopLag } from "../obs/metrics";
import { internalRoute, type InternalAuthDeps } from "./allow";

export interface LoadRouteDeps extends InternalAuthDeps {
  io: Server;
  /** A monitor of this route's own (reset after each read), never the metrics push's. */
  loopLag: LoopLag;
  /** Sessions in study, first_move or playing. */
  liveGames(): number;
  draining(): boolean;
}

/** One reading; starts the next lag window. */
export function loadSnapshot(deps: Omit<LoadRouteDeps, keyof InternalAuthDeps>): LoadResponse {
  const p99 = deps.loopLag.p99();
  deps.loopLag.reset();
  return {
    loopLagP99Ms: Number.isFinite(p99) && p99 > 0 ? Math.round(p99 * 10) / 10 : 0,
    liveGames: deps.liveGames(),
    sockets: deps.io.engine?.clientsCount ?? 0,
    draining: deps.draining(),
  };
}

export function mountLoad(app: Express, deps: LoadRouteDeps): void {
  app.get(
    "/internal/load",
    ...internalRoute(deps, "/internal/load", (_req, res) => {
      res.set("cache-control", "no-store").json(loadSnapshot(deps));
    }),
  );
}
