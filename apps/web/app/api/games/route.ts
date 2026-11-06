// POST /api/games (phase-02 plan §7.1.1): creates a bot game; replaces POST /api/chess/create-ai-game.
// Member only (402 otherwise, route()); `Idempotency-Key` (UUID v4) required: a replay answers the stored 201 with
// `Idempotent-Replayed: true`, the same key with another body is 422 idempotency_key_reused, and a request still
// running is 409 in_flight (retryAfterSec 2). Rate limit `create-game` 20 / 10 min (registry). Body ≤ 4 KB.
import { gamesEndpoints } from "@repo/contracts/http/registry";
import { captureGameServerEvent } from "@/lib/analytics/server-events";
import {
  IDEMPOTENCY_REPLAYED_HEADER,
  readIdempotencyKey,
  requestHash,
  withIdempotency,
} from "@/lib/api/idempotency";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { createBotGame } from "@/lib/games/create-bot-game.server";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const POST = route(gamesEndpoints.create, async (ctx) => {
  const viewer = ctx.viewer!;
  const key = readIdempotencyKey(ctx.req.headers, { required: true })!;
  const out = await withIdempotency(
    rawDb(prisma),
    { userId: viewer.id, key, route: gamesEndpoints.create.id, hash: requestHash(ctx.body), now: ctx.now },
    async () => {
      const { snapshot, botElo, color } = await createBotGame(prisma, viewer, ctx.body, ctx.now);
      // Telemetry (plan §10.1) only for a fresh create, never for an idempotent replay.
      ctx.after(() =>
        captureGameServerEvent(
          "bot_game_started",
          {
            elo: botElo,
            color,
            start_kind: ctx.body.parentGameRef ? "parent" : ctx.body.start.kind,
            reason: ctx.body.reason,
          },
          viewer.ref,
        ),
      );
      return { status: 201, body: { game: snapshot } };
    },
  );
  return respondWith(out.body, {
    status: 201,
    location: `/game/${out.body.game.ref}`,
    ...(out.replayed ? { headers: { [IDEMPOTENCY_REPLAYED_HEADER]: "true" } } : {}),
  });
});
