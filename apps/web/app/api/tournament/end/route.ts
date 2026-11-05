import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { resolveUser } from "@/lib/auth/resolve-user";
import { notifyTournamentEvent } from "@/lib/services/tournament/notify-websocket";

const endSchema = z.object({
  tournamentReferenceId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const dbUser = await resolveUser(request);
    if (!dbUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const data = endSchema.parse(body);

    const tournament = await prisma.tournament.findUnique({
      where: { referenceId: data.tournamentReferenceId },
    });

    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    if (tournament.createdByUserId !== dbUser.id) {
      return NextResponse.json(
        { error: "Only the tournament creator can end it" },
        { status: 403 }
      );
    }

    if (tournament.status !== "ACTIVE" && tournament.status !== "LOBBY") {
      return NextResponse.json(
        { error: "Tournament is not active" },
        { status: 400 }
      );
    }

    await prisma.$transaction([
      prisma.tournament.update({
        where: { id: tournament.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
        },
      }),
      prisma.tournamentParticipant.updateMany({
        where: { tournamentId: tournament.id, isSearching: true },
        data: { isSearching: false, searchingSince: null },
      }),
    ]);

    logger.info(`Tournament ${tournament.referenceId} ended manually`);

    after(() =>
      notifyTournamentEvent({
        event: "tournament_ended",
        tournamentReferenceId: tournament.referenceId,
      })
    );

    return NextResponse.json({
      success: true,
      data: { status: "COMPLETED" },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }
    logger.error("Error ending tournament", error);
    return NextResponse.json(
      { error: "Failed to end tournament" },
      { status: 500 }
    );
  }
}
