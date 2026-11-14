// PATCH /api/review/[ref]/moments/[ply] (phase-03 plan §7.2 A6; phase-05 plan §7.3 "A6 moment toggle"): keep a key
// moment in or out of the Mistake Bank. Set semantics. With P5's `train` flag the card follows the switch in the same
// transaction as P3's `progress.bankOptOut` write (lib/train/links.server.ts) and the response carries it; with the
// flag off an opt-in records only the opt-out flag (P3-D19), while an opt-out still deletes a card an extraction batch
// already made (FIX-2, P5-FX-13: J1 is not flag-gated, so without this the bank would hold an opted-out moment once the
// flag turns on); `card` is null with the flag off. After a card change the member's other devices hear
// `bank:due_changed`.
import { reviewEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { getFlags } from "@/lib/flags";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { setMomentBank } from "@/lib/services/analysis/walkthrough";
import { bankDueNow, emitBankDueChanged } from "@/lib/train/events.server";
import { setMomentInBank } from "@/lib/train/links.server";

export const dynamic = "force-dynamic";

export const PATCH = route(reviewEndpoints.moment, async (ctx) => {
  const viewer = ctx.viewer!;
  const { ref, ply } = ctx.params;
  if (!(await getFlags(viewer)).train) {
    if (!ctx.body.inBank) {
      const off = await setMomentInBank(viewer, ref, ply, false, ctx.now);
      if (off === "admin_noop") return new Response(null, { status: 204 });
      return { ply, inBank: false, card: null };
    }
    const out = await setMomentBank(rawDb(prisma), viewer, ref, ply, ctx.body.inBank);
    if (out === "admin_noop") return new Response(null, { status: 204 });
    return { ply, inBank: ctx.body.inBank, card: null };
  }
  const out = await setMomentInBank(viewer, ref, ply, ctx.body.inBank, ctx.now);
  if (out === "admin_noop") return new Response(null, { status: 204 });
  ctx.after(async () => {
    const due = await bankDueNow(viewer, ctx.now);
    await emitBankDueChanged(viewer.ref, due, ctx.now);
  });
  return out;
});
