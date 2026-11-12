// The share DAL for server components (phase-03 plan §5.4, §5.5, §7.3). Server-only.
//
// - getActiveShare: the share page's seed for `qk.review.share(ref)` (React cache() per request). It never creates a
//   link (prefetch safety, §11.2 rule 3): the page's client effect sends A10. Throws DataError not_found for an unknown
//   game or a non-player (the page turns it into notFound()).
// - loadPublicShare: the ONE tagged loader `/r/[code]` and `/r/[code]/og` both read (§5.5): `unstable_cache` keyed by
//   the code, tag `share:<code>` (purged by A11's revalidateTag), revalidated at most hourly, so expiry shows within
//   1 h and an unknown code costs at most one render per hour (AP-47). It reads only the snapshot columns.
import "server-only";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { SHARE_REVALIDATE_SEC, shareCacheTag, type ShareDTO } from "@repo/contracts/http/share";
import type { Viewer } from "@/lib/auth/viewer";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { getActiveShare as readActiveShare, getPublicShare, type PublicShare } from "@/lib/services/analysis/share";

export { DataError, isNotFound } from "./errors";
export type { PublicShare };

/** The viewer's live link for the game (ShareDTO) or null; DataError not_found for a non-player. */
export const getActiveShare = cache(
  async (viewer: Viewer, ref: string): Promise<ShareDTO | null> => readActiveShare(rawDb(prisma), viewer, ref),
);

/** The public share by code, through the tagged data cache (ISR page + image route). */
export function loadPublicShare(code: string): Promise<PublicShare> {
  return unstable_cache(() => getPublicShare(rawDb(prisma), code), ["share", code], {
    tags: [shareCacheTag(code)],
    revalidate: SHARE_REVALIDATE_SEC,
  })();
}
