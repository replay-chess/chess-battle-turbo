// POST /api/train/cards/{ref}/skip (phase-05 plan §7.2 W5, §7.3): "Skip for today": the card waits for the next
// release; with `sessionRef` the session's item is marked skipped. 404 for another member's card or session.
import { trainEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { skipCard } from "@/lib/train/cards.server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const POST = route(trainEndpoints.cardSkip, async (ctx) => skipCard(ctx.viewer!, ctx.params.ref, ctx.body.sessionRef, ctx.now));
