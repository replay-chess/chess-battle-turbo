// POST /internal/drain (kid `ops`, phase-02 plan 7.5): `{ v: 1 }` → 202, then the same drain as SIGTERM
// (src/persist/drain.ts) and a clean exit, so compose's restart policy brings a fresh process up that restores the
// games (manual use only). Blocked at Caddy.
import type { Express } from "express";
import { DrainBody } from "@repo/contracts/socket/internal";
import { internalRoute, jsonOf, sendError, type InternalAuthDeps } from "./allow";

export interface DrainRouteDeps extends InternalAuthDeps {
  requestDrain(): void;
}

export function mountDrain(app: Express, deps: DrainRouteDeps): void {
  app.post(
    "/internal/drain",
    ...internalRoute(deps, "/internal/drain", (_req, res, { raw }) => {
      if (!DrainBody.safeParse(jsonOf(raw)).success) return sendError(res, 400, "validation_failed");
      res.status(202).json({ draining: true });
      deps.log.info("drain requested over /internal/drain");
      // After the response is flushed.
      setImmediate(() => deps.requestDrain());
    }),
  );
}
