// GET /api/games/[ref]/pgn (phase-02 plan §7.1.5): the finished game's PGN (built once at the end, with %clk) as a
// download. Member + player (bot or live). `private, no-store` (the registry tier): a download is never kept in the
// browser HTTP cache, where the next user of a shared device could reach it (api-perf AP-04). 409 conflict
// {reason: not_finished} while the game is live; 403 for a spectator; 404 otherwise.
import { gamesEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { rawDb, readGamePgn } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = route(gamesEndpoints.pgn, async (ctx) => {
  const pgn = await readGamePgn(rawDb(prisma), ctx.params.ref, ctx.viewer!.id);
  return new Response(pgn, {
    status: 200,
    headers: {
      "Content-Type": "text/x-chess-pgn; charset=utf-8",
      "Content-Disposition": `attachment; filename="replaychess-${ctx.params.ref}.pgn"`,
    },
  });
});
