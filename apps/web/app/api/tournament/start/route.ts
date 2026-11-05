import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { resolveUser } from "@/lib/auth/resolve-user";
import { notifyTournamentEvent } from "@/lib/services/tournament/notify-websocket";

const startSchema = z.object({
  tournamentReferenceId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const dbUser = await resolveUser(request);
    if (!dbUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const data = startSchema.parse(body);

    const tournament = await prisma.tournament.findUnique({
      where: { referenceId: data.tournamentReferenceId },
    });

    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    if (tournament.createdByUserId !== dbUser.id) {
      return NextResponse.json(
        { error: "Only the tournament creator can start it" },
        { status: 403 }
      );
    }

    if (tournament.status !== "LOBBY") {
      return NextResponse.json(
        { error: "Tournament can only be started from LOBBY state" },
        { status: 400 }
      );
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + tournament.durationMinutes * 60 * 1000);

    await prisma.tournament.update({
      where: { id: tournament.id },
      data: {
        status: "ACTIVE",
        startedAt: now,
        endsAt,
      },
    });

    logger.info(`Tournament ${tournament.referenceId} started, ends at ${endsAt.toISOString()}`);

    after(() =>
      notifyTournamentEvent({
        event: "tournament_started",
        tournamentReferenceId: tournament.referenceId,
        data: { startedAt: now.toISOString(), endsAt: endsAt.toISOString() },
      })
    );

    return NextResponse.json({
      success: true,
      data: {
        status: "ACTIVE",
        startedAt: now.toISOString(),
        endsAt: endsAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }
    logger.error("Error starting tournament", error);
    return NextResponse.json(
      { error: "Failed to start tournament" },
      { status: 500 }
    );
  }
}
