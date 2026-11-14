// PATCH /api/train/prefs (phase-05 plan §7.2 W8, §7.3): the only writer of training prefs (time zone, day start,
// release hour, cap, new per day, auto-grade). `train-write` 120 / 60 s.
import { trainEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { updatePrefs } from "@/lib/train/prefs.server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const PATCH = route(trainEndpoints.prefs, async (ctx) => updatePrefs(ctx.viewer!, ctx.body));
