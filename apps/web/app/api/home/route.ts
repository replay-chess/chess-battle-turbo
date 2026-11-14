// GET /api/home (phase-05 plan §7.2 HOME-1, §7.3): the member landing page's client refetch (the `/home` page seeds
// the same DTO from lib/home/home.server.ts). Member only; `no-store`; reads only.
import { homeEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { getHomeData } from "@/lib/home/home.server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const GET = route(homeEndpoints.get, async (ctx) => getHomeData(ctx.viewer!, ctx.now));
