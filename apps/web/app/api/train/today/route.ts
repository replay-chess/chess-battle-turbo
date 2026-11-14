// GET /api/train/today (phase-05 plan §7.2 R1, §7.3): the hub's client refetch (the `/train` page seeds the same DTO
// from lib/train/today.server.ts). Member only; `no-store`. Its only writes are the registered GET side effect
// `daily_plan`: today's frozen plan and the lazy training profile, once per local day.
import { trainEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { getTrainToday } from "@/lib/train/today.server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const GET = route(trainEndpoints.today, async (ctx) => getTrainToday(ctx.viewer!, ctx.now));
