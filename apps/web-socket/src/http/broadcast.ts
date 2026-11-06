// POST /internal/broadcast (kid `ops`, phase-02 plan 7.5, 7.11): `{ v: 1, type: "restart", inSeconds: 5..600 }` →
// 202 `{ restartAt, rooms }`. Sets `draining` (no new sessions or rematches) and sends `server:restarting
// {restartAt, resumes: true}` to every game and spectate room. Blocked at Caddy; reached through
// `docker compose exec websocket node dist/cli/internal.js broadcast --in 30`.
import type { Express } from "express";
import { BroadcastBody, type BroadcastResponse } from "@repo/contracts/socket/internal";
import { internalRoute, jsonOf, sendError, type InternalAuthDeps } from "./allow";

export interface BroadcastDeps extends InternalAuthDeps {
  announceRestart(inSeconds: number): { restartAt: number; rooms: number };
}

export function mountBroadcast(app: Express, deps: BroadcastDeps): void {
  app.post(
    "/internal/broadcast",
    ...internalRoute(deps, "/internal/broadcast", (_req, res, { raw }) => {
      const parsed = BroadcastBody.safeParse(jsonOf(raw));
      if (!parsed.success) return sendError(res, 400, "validation_failed");
      const out = deps.announceRestart(parsed.data.inSeconds);
      deps.log.info("restart notice broadcast", { inSeconds: parsed.data.inSeconds, rooms: out.rooms });
      res.status(202).json(out satisfies BroadcastResponse);
    }),
  );
}
