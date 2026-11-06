// POST /api/games/[ref]/complete (phase-02 plan §7.1.4): finishes a bot game after server-side adjudication
// (§8.16, lib/games/complete-bot-game.server.ts). User + player of this BOT game. An already finished game answers
// its stored result with `Idempotent-Replayed: true` (natural idempotency on the ref). Body ≤ 16 KB.
import { gamesEndpoints } from "@repo/contracts/http/registry";
import { captureGameServerEvent } from "@/lib/analytics/server-events";
import { IDEMPOTENCY_REPLAYED_HEADER } from "@/lib/api/idempotency";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { completeBotGame } from "@/lib/games/complete-bot-game.server";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const POST = route(gamesEndpoints.complete, async (ctx) => {
  const viewer = ctx.viewer!;
  const { response, replayed, completed } = await completeBotGame(rawDb(prisma), ctx.params.ref, viewer.id, ctx.body, ctx.now);
  // Telemetry (plan §10.1): once, from the call that finished the game.
  if (completed) ctx.after(() => captureGameServerEvent("bot_game_completed", completed, viewer.ref));
  return respondWith(response, replayed ? { headers: { [IDEMPOTENCY_REPLAYED_HEADER]: "true" } } : {});
});
