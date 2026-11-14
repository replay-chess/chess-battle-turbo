// GET /api/train/themes (phase-05 plan §7.2 R4): the puzzle theme picker's options. Reads only.
import { trainEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { listThemes } from "@/lib/train/themes.server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const GET = route(trainEndpoints.themes, async (ctx) => listThemes(ctx.viewer!));
