// GET /api/review/[ref]/pgn (phase-03 plan §7.2 A8, §8.15): the annotated PGN ([%eval], [%clk], NAGs, the moments'
// "why" text) as a download. `private, no-store` + Content-Disposition attachment (AP-04): never kept in a cache a
// shared device's next user could reach. 409 analysis_not_done until the review is done.
import { annotatedPgnFilename } from "@repo/contracts/http/review";
import { reviewEndpoints } from "@repo/contracts/http/registry";
import { buildAnnotatedPgn } from "@repo/chess-analysis/pgn";
import { ApiError } from "@/lib/api/api-error";
import { route } from "@/lib/api/route";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { siteOrigin } from "@/lib/routes";
import { getReview } from "@/lib/services/analysis/read";
import { requireReviewReader } from "@/lib/services/analysis/reader";

export const dynamic = "force-dynamic";

export const GET = route(reviewEndpoints.pgn, async (ctx) => {
  const viewer = await requireReviewReader(ctx);
  const { dto } = await getReview(rawDb(prisma), viewer, ctx.params.ref, ctx.now.getTime());
  if (dto.status !== "done") throw new ApiError("conflict", { details: { reason: "analysis_not_done" } });
  const pgn = buildAnnotatedPgn(dto, { site: siteOrigin() });
  const filename = annotatedPgnFilename(dto.players.w.name, dto.players.b.name, new Date(dto.game.playedAt));
  return new Response(pgn, {
    status: 200,
    headers: {
      "Content-Type": "text/x-chess-pgn; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
