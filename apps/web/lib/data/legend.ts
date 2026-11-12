// The compare-with-the-legend DAL for server components (phase-03 plan §5.7): the same read as A9, memoised per
// request. Server-only. It may insert the derived facts row (`legend_facts`) but never enqueues engine work, so the
// page (and a router prefetch of it) is side-effect free as far as the worker is concerned.
import "server-only";
import { cache } from "react";
import type { LegendCompareDTO } from "@repo/contracts/http/legend";
import type { Viewer } from "@/lib/auth/viewer";
import { requestNow } from "@/lib/api/now";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { buildLegendCompareDTO, getLegendCompare as readLegendCompare } from "@/lib/services/analysis/legend";

/** LegendCompareDTO for `qk.review.legend(ref)` (without the explanation). DataError not_found → the page 308s. */
export const getLegendCompare = cache(async (viewer: Viewer, ref: string): Promise<LegendCompareDTO> => {
  const nowMs = (await requestNow()).getTime();
  const read = await readLegendCompare(rawDb(prisma), viewer, ref, { includeExplanation: false });
  return buildLegendCompareDTO(read, { include: false, nowMs });
});
