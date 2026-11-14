// POST /api/train/sessions/{ref}/extend (phase-05 plan §7.2 W3, §7.3): 10 more puzzles for a streaming puzzle session.
// Idempotent on `after`; 409 `session_ended` once the session is not ACTIVE; the daily puzzle fair use (429) and a
// shard outage (502) as W2. `train-write` 120 / 60 s.
import { trainEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { extendSession } from "@/lib/train/sessions.server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const POST = route(trainEndpoints.sessionExtend, async (ctx) => extendSession(ctx.viewer!, ctx.params.ref, ctx.body.after, ctx.now));
