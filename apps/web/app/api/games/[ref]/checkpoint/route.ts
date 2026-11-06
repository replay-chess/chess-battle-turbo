// POST /api/games/[ref]/checkpoint (phase-02 plan §7.1.3): a bot game's journal, sent with sendBeacon (text/plain)
// on pagehide and with fetch keepalive every 10 plies. User + player of this BOT game (membership not re-checked).
// 204 on success AND when the rev guard skips the write (late or duplicate beacon); 409 conflict {reason: rev_gap}
// when the rev jumps more than 64; 422 illegal_moves. Rate limit `bot-checkpoint` 60 / 60 s, body ≤ 8 KB (registry).
import { gamesEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { checkpointBotGame } from "@/lib/games/checkpoint.server";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const POST = route(gamesEndpoints.checkpoint, async (ctx) => {
  await checkpointBotGame(rawDb(prisma), ctx.params.ref, ctx.viewer!.id, ctx.body);
  return undefined;
});
