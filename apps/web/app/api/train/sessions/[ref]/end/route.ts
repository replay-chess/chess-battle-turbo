// POST /api/train/sessions/{ref}/end (phase-05 plan §7.2 W4, §7.3): ends the session and answers its summary; a second
// call answers the same summary. After a bank session the member's other devices hear `bank:due_changed`.
import { trainEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { bankDueNow, emitBankDueChanged } from "@/lib/train/events.server";
import { endSession } from "@/lib/train/sessions.server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const POST = route(trainEndpoints.sessionEnd, async (ctx) => {
  const viewer = ctx.viewer!;
  const out = await endSession(viewer, ctx.params.ref, ctx.body.reason, ctx.now);
  if (out.ended && (out.kind === "BANK" || out.kind === "DAILY")) {
    ctx.after(async () => emitBankDueChanged(viewer.ref, await bankDueNow(viewer, ctx.now), ctx.now));
  }
  return out.summary;
});
