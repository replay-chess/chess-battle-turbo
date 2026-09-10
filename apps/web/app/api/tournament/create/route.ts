import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { requireSubscribedUser } from "@/lib/auth/require-subscription";

const createTournamentSchema = z.object({
  name: z.string().min(1, "Tournament name is required").max(100),
  description: z.string().min(1, "Description is required").max(50),
  mode: z.enum(["OPENING", "LEGEND", "ENDGAME", "FREE"]),
  durationMinutes: z.number().int().min(5).max(480),
  initialTimeSeconds: z.number().int().positive(),
  incrementSeconds: z.number().int().min(0),
  maxParticipants: z.number().int().min(2).max(256).nullable().optional(),
  openingReferenceId: z.string().nullable().optional(),
  legendReferenceId: z.string().nullable().optional(),
  chessPositionReferenceId: z.string().nullable().optional(),
  scheduledStartAt: z.string().datetime(),
});

export async function POST(request: NextRequest) {
  try {
    // Creating a tournament enrolls the creator, so it needs a Player plan.
    const gate = await requireSubscribedUser(request);
    if (gate.response) return gate.response;
    const dbUser = gate.user;

    const body = await request.json();
    const data = createTournamentSchema.parse(body);

    // Resolve FK IDs based on mode
    let openingId: bigint | null = null;
    let legendId: bigint | null = null;
    let chessPositionId: bigint | null = null;

    if (data.mode === "OPENING" && data.openingReferenceId) {
      const opening = await prisma.opening.findUnique({
        where: { referenceId: data.openingReferenceId },
      });
      if (!opening) {
        return NextResponse.json({ error: "Opening not found" }, { status: 404 });
      }
      openingId = opening.id;
    }

    if (data.mode === "LEGEND" && data.legendReferenceId) {
      const legend = await prisma.legend.findUnique({
        where: { referenceId: data.legendReferenceId },
      });
      if (!legend) {
        return NextResponse.json({ error: "Legend not found" }, { status: 404 });
      }
      legendId = legend.id;
    }

    if (data.mode === "ENDGAME" && data.chessPositionReferenceId) {
      const position = await prisma.chessPosition.findUnique({
        where: { referenceId: data.chessPositionReferenceId },
      });
      if (!position) {
        return NextResponse.json({ error: "Chess position not found" }, { status: 404 });
      }
      chessPositionId = position.id;
    }

    const tournament = await prisma.tournament.create({
      data: {
        name: data.name,
        description: data.description,
        mode: data.mode,
        status: "LOBBY",
        durationMinutes: data.durationMinutes,
        initialTimeSeconds: data.initialTimeSeconds,
        incrementSeconds: data.incrementSeconds,
        maxParticipants: data.maxParticipants ?? null,
        openingId,
        legendId,
        chessPositionId,
        createdByUserId: dbUser.id,
        scheduledStartAt: new Date(data.scheduledStartAt),
      },
    });

    // Auto-join creator as first participant
    await prisma.tournamentParticipant.create({
      data: {
        tournamentId: tournament.id,
        userId: dbUser.id,
      },
    });

    logger.info(`Tournament created: ${tournament.referenceId} by ${dbUser.referenceId}`);

    return NextResponse.json(
      {
        success: true,
        data: {
          referenceId: tournament.referenceId,
          name: tournament.name,
          mode: tournament.mode,
          status: tournament.status,
          scheduledStartAt: tournament.scheduledStartAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }
    logger.error("Error creating tournament", error);
    return NextResponse.json(
      { error: "Failed to create tournament" },
      { status: 500 }
    );
  }
}
