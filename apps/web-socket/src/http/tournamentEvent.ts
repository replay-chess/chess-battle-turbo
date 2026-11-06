// POST /internal/tournament-event (kid `web`, phase-02 plan 7.5; removed in P12): the legacy arena lobby events
// (`tournament_*` to `tournament:{slug}`), now HMAC-signed by the web app's `internalFetch()`. A request with no
// signing headers falls through to the v1 static-token route only while PROTOCOL_V1=on (src/v1/runtime.ts).
import type { Express } from "express";
import { TournamentEventBody } from "@repo/contracts/socket/internal";
import type { TournamentManager } from "../legacy/TournamentManager";
import { internalRoute, jsonOf, sendError, type InternalAuthDeps } from "./allow";

export interface TournamentEventDeps extends InternalAuthDeps {
  tournaments: TournamentManager;
  /** PROTOCOL_V1=on: unsigned requests go on to the v1 route. */
  legacyFallback: boolean;
}

export function mountTournamentEvent(app: Express, deps: TournamentEventDeps): void {
  app.post(
    "/internal/tournament-event",
    ...internalRoute(
      deps,
      "/internal/tournament-event",
      (_req, res, { raw }) => {
        const parsed = TournamentEventBody.safeParse(jsonOf(raw));
        if (!parsed.success) return sendError(res, 400, "validation_failed");
        const { event, tournamentReferenceId, data } = parsed.data;
        if (!deps.tournaments.emitLegacyEvent(event, tournamentReferenceId, data)) {
          return sendError(res, 400, "validation_failed");
        }
        deps.metrics.count("ws.emit", { event: `tournament_${event}`, result: "delivered" });
        res.json({ success: true });
      },
      { fallthroughUnsigned: deps.legacyFallback },
    ),
  );
}
