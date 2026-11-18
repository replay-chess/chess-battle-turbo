// POST /api/train/weakness/seen (phase-06 plan §7.1.3 TR-13): 204. Clears the Train dot after a real view of the
// profile (never a GET side effect: an intent prefetch must not clear it). Idempotent, clamped to the real version.
// `train-write` 120 / 60 s. Member only; the `weakness` flag off answers 404.
import { trainEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { assertWeaknessEnabled } from "@/lib/train/weakness.server";
import { markWeaknessSeen } from "@/lib/train/weakness-write.server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const POST = route(trainEndpoints.weaknessSeen, async (ctx) => {
  const viewer = ctx.viewer!;
  await assertWeaknessEnabled(viewer);
  await markWeaknessSeen(viewer, ctx.body.version);
});
