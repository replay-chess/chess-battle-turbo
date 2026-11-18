// GET /api/me/badges (phase-05 plan §7.2 R8, §8.5): the nav badges (the capped Mistake Bank due count and the Train
// dot): one statement, the same badge facts the viewer statement folds into /api/me, at the request clock `ctx.now`.
// P6 (phase-06 plan §7.1.5 ME-2): with the viewer's `weakness` flag on, `weaknessReady` (a new profile not yet seen)
// comes from the same statement and lights `trainDot`; off, the body is P5's. The flag costs no query (PostHog local
// evaluation, or the registry default).
import { homeEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { getFlags } from "@/lib/flags";
import { prisma } from "@/lib/prisma";
import { getBadges } from "@/lib/train/badges.server";
import { timeZoneOf } from "@/lib/train/day.server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const GET = route(homeEndpoints.badges, async (ctx) => {
  const viewer = ctx.viewer!;
  const flags = await getFlags(viewer);
  return getBadges(prisma, { id: viewer.id, timeZone: timeZoneOf(viewer) }, ctx.now, { weakness: flags.weakness === true });
});
