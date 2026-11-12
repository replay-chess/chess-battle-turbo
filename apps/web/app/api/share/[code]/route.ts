// PATCH / DELETE /api/share/[code] (phase-03 plan §7.2 A11, §5.4, §5.5, §11.3): the owner's username toggle and Stop
// Sharing. Owner only (`shares.ownerId`, 404 otherwise, admins included); not flagged, so an owner can always turn a
// link off. PATCH recomputes only the sharer's name in the frozen snapshot and bumps `imageVersion` (the image URL's
// `?v=`); 410 gone for a revoked or expired link. DELETE sets `revokedAt` once; a repeat is 204 too. A change purges
// the ISR page and its data-cache entry now (`revalidateTag("share:<code>")`) and the image's CDN copy in `after()`.
import { shareEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { purgeShare, revokeShare, updateShare } from "@/lib/services/analysis/share";

export const dynamic = "force-dynamic";

export const PATCH = route(shareEndpoints.update, async (ctx) => {
  const out = await updateShare(rawDb(prisma), ctx.viewer!, ctx.params.code, ctx.body.showUsername);
  if (out.changed) purgeShare(ctx, ctx.params.code);
  return out.dto;
});

export const DELETE = route(shareEndpoints.revoke, async (ctx) => {
  await revokeShare(rawDb(prisma), ctx.viewer!, ctx.params.code);
  purgeShare(ctx, ctx.params.code);
  return undefined;
});
