// POST /api/chess/cancel-game (legacy, kept until P9; phase-02 plan §7.2). The cancel is ONE conditional statement:
// only the creator, only while WAITING_FOR_OPPONENT (a join that won the race cannot be cancelled underneath the
// joiner). It also closes the creator's game_players row (result ABORTED, so the challenge leaves "my live games")
// and bumps the creator's gamesVersion. count = 0 → the legacy 404/403/400 answers, read back once.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@repo/db";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/errors/validation-error";
import { resolveUser } from "@/lib/auth/resolve-user";
import { logger } from "@/lib/logger";

const cancelGameSchema = z.object({
  gameReferenceId: z.string().min(1, "Game reference ID is required"),
});

function cancelSql(ref: string, userId: bigint): Prisma.Sql {
  return Prisma.sql`
    WITH g AS (
      UPDATE games SET status = 'CANCELLED', phase = 'ENDED', "completedAt" = now(), "updatedAt" = now()
       WHERE "referenceId" = ${ref} AND "creatorId" = ${userId} AND status = 'WAITING_FOR_OPPONENT'
      RETURNING id
    ), gp AS (
      UPDATE game_players p SET result = 'ABORTED', "endedAt" = now(), "updatedAt" = now()
        FROM g WHERE p."gameId" = g.id
      RETURNING p."userId"
    ), uv AS (
      UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1 FROM gp WHERE u.id = gp."userId"
      RETURNING u.id
    )
    SELECT (SELECT count(*) FROM g)::int AS cancelled`;
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = cancelGameSchema.parse(body);

    // (text, ...values), not $queryRaw(Sql): see rawDb() in lib/games/snapshot.server.ts.
    const sql = cancelSql(validatedData.gameReferenceId, user.id);
    const rows = await prisma.$queryRawUnsafe<{ cancelled: number }[]>(sql.text, ...sql.values);
    if (rows[0]?.cancelled === 1) return NextResponse.json({ success: true });

    // Nothing changed: say why, as before.
    const game = await prisma.game.findUnique({
      where: { referenceId: validatedData.gameReferenceId },
      select: { status: true, creatorId: true },
    });
    if (!game) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }
    if (game.creatorId !== user.id) {
      return NextResponse.json({ error: "Only the game creator can cancel this game" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Only games waiting for an opponent can be cancelled", code: "conflict", details: { reason: "already_started" } },
      { status: 409 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: error.issues.map((err) => ({
            field: err.path.join("."),
            message: err.message,
          })),
        },
        { status: 400 }
      );
    }

    if (error instanceof ValidationError) {
      return NextResponse.json(
        {
          error: error.message,
          ...(error.details && { details: error.details }),
        },
        { status: error.statusCode }
      );
    }

    logger.error("Error cancelling game", error);
    return NextResponse.json(
      {
        error: "Failed to cancel game",
      },
      { status: 500 }
    );
  }
}
