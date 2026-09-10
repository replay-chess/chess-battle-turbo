import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { requireSubscribedUser } from "@/lib/auth/require-subscription";
import { notifyTournamentEvent } from "@/lib/services/tournament/notify-websocket";

const joinSchema = z.object({
  tournamentReferenceId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const gate = await requireSubscribedUser(request);
    if (gate.response) return gate.response;
    const dbUser = gate.user;

    const body = await request.json();
    const data = joinSchema.parse(body);

    const tournament = await prisma.tournament.findUnique({
      where: { referenceId: data.tournamentReferenceId },
      include: { _count: { select: { participants: true } } },
    });

    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    if (tournament.status !== "LOBBY") {
      return NextResponse.json(
        { error: "Registration is closed — tournament has already started" },
        { status: 400 }
      );
    }

    if (
      tournament.maxParticipants &&
      tournament._count.participants >= tournament.maxParticipants
    ) {
      return NextResponse.json(
        { error: "Tournament is full" },
        { status: 400 }
      );
    }

    // Check if already joined
    const existing = await prisma.tournamentParticipant.findUnique({
      where: {
        tournamentId_userId: {
          tournamentId: tournament.id,
          userId: dbUser.id,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { success: true, message: "Already joined" },
        { status: 200 }
      );
    }

    await prisma.tournamentParticipant.create({
      data: {
        tournamentId: tournament.id,
        userId: dbUser.id,
      },
    });

    logger.info(`User ${dbUser.referenceId} joined tournament ${tournament.referenceId}`);

    notifyTournamentEvent({
      event: "player_joined",
      tournamentReferenceId: tournament.referenceId,
      data: {
        referenceId: dbUser.referenceId,
        name: dbUser.name,
        profilePictureUrl: dbUser.profilePictureUrl,
      },
    });

    return NextResponse.json(
      { success: true, message: "Joined tournament" },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }
    logger.error("Error joining tournament", error);
    return NextResponse.json(
      { error: "Failed to join tournament" },
      { status: 500 }
    );
  }
}
