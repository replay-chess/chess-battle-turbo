// GET /api/train/sessions/{ref} (phase-05 plan §7.2 R3): one of the viewer's sessions, `include=items` (the runner's
// payload, the default) or `include=summary`. 404 for another member's ref. Reads only.
import { trainEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { getSession, getSessionSummary } from "@/lib/train/sessions.server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const GET = route(trainEndpoints.session, async (ctx) =>
  ctx.query.include === "summary"
    ? getSessionSummary(ctx.viewer!, ctx.params.ref, ctx.now)
    : getSession(ctx.viewer!, ctx.params.ref, ctx.now),
);
