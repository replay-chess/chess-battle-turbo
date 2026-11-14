// DELETE /api/train/cards/{ref} (phase-05 plan §7.2 W6, §7.3): removes a position from the Mistake Bank (the card goes,
// the mistake is hidden, the FSRS history stays). 204, also when it was removed before; 404 for a ref that was never
// the viewer's. The UI offers it behind `bank-remove` (Undo for 6 s before the call). `train-write` 120 / 60 s.
import { trainEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { removeCard } from "@/lib/train/cards.server";
import { bankDueNow, emitBankDueChanged } from "@/lib/train/events.server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const DELETE = route(trainEndpoints.cardRemove, async (ctx) => {
  const viewer = ctx.viewer!;
  const out = await removeCard(viewer, ctx.params.ref, ctx.now);
  if (out.removed) ctx.after(async () => emitBankDueChanged(viewer.ref, await bankDueNow(viewer, ctx.now), ctx.now));
  return undefined;
});
