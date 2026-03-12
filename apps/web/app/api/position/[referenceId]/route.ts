import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ referenceId: string }> }
) {
  try {
    const { referenceId } = await params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    if (type === "opening") {
      const opening = await prisma.opening.findUnique({
        where: { referenceId },
        select: {
          referenceId: true,
          name: true,
          eco: true,
          pgn: true,
          fen: true,
          sideToMove: true,
        },
      });

      if (!opening) {
        return NextResponse.json(
          { success: false, error: "Opening not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        data: {
          type: "opening",
          referenceId: opening.referenceId,
          fen: opening.fen,
          sideToMove: opening.sideToMove,
          name: opening.name,
          eco: opening.eco,
          pgn: opening.pgn,
          whitePlayerName: null,
          blackPlayerName: null,
          tournamentName: null,
        },
      });
    }

    // Default: ChessPosition
    const position = await prisma.chessPosition.findUnique({
      where: { referenceId },
      select: {
        referenceId: true,
        fen: true,
        sideToMove: true,
        whitePlayerName: true,
        blackPlayerName: true,
        tournamentName: true,
      },
    });

    if (!position) {
      return NextResponse.json(
        { success: false, error: "Position not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        type: "position",
        referenceId: position.referenceId,
        fen: position.fen,
        sideToMove: position.sideToMove,
        whitePlayerName: position.whitePlayerName,
        blackPlayerName: position.blackPlayerName,
        tournamentName: position.tournamentName,
        name: null,
        eco: null,
        pgn: null,
      },
    });
  } catch (error) {
    logger.error("Error fetching position:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch position",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
