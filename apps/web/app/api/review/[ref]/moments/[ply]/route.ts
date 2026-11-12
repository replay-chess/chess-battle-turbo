// PATCH /api/review/[ref]/moments/[ply] (phase-03 plan §7.2 A6): keep a key moment in or out of the Mistake Bank
// (`progress.bankOptOut`; the UI is hidden until P5's `train` flag, P3-D19). Set semantics; `card` is P5's.
import { reviewEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { setMomentBank } from "@/lib/services/analysis/walkthrough";

export const dynamic = "force-dynamic";

export const PATCH = route(reviewEndpoints.moment, async (ctx) => {
  const out = await setMomentBank(rawDb(prisma), ctx.viewer!, ctx.params.ref, ctx.params.ply, ctx.body.inBank);
  if (out === "admin_noop") return new Response(null, { status: 204 });
  return { ply: ctx.params.ply, inBank: ctx.body.inBank, card: null };
});
