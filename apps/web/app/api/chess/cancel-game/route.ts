import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/errors/validation-error";
import { validateAndFetchUser } from "@/lib/services/user-validation.service";
import { logger } from "@/lib/logger";

const cancelGameSchema = z.object({
  gameReferenceId: z.string().min(1, "Game reference ID is required"),
  userReferenceId: z.string().min(1, "User reference ID is required"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = cancelGameSchema.parse(body);

    const user = await validateAndFetchUser(validatedData.userReferenceId);

    const game = await prisma.game.findUnique({
      where: { referenceId: validatedData.gameReferenceId },
    });

    if (!game) {
      return NextResponse.json(
        { error: "Game not found" },
        { status: 404 }
      );
    }

    if (game.status !== "WAITING_FOR_OPPONENT") {
      return NextResponse.json(
        { error: "Only games waiting for an opponent can be cancelled" },
        { status: 400 }
      );
    }

    if (game.creatorId !== user.id) {
      return NextResponse.json(
        { error: "Only the game creator can cancel this game" },
        { status: 403 }
      );
    }

    await prisma.game.update({
      where: { id: game.id },
      data: { status: "CANCELLED" },
    });

    return NextResponse.json({ success: true });
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
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
