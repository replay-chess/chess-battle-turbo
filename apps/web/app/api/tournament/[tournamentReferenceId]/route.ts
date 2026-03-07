import { NextRequest, NextResponse } from "next/server";
import {
  getTournamentByRef,
  autoCompleteTournamentIfExpired,
  serializeTournament,
  getCurrentUserParticipant,
  searchTournamentParticipants,
} from "@/lib/services/tournament/tournament.service";
import { notifyTournamentEvent } from "@/lib/services/tournament/notify-websocket";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { auth } from "@clerk/nextjs/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentReferenceId: string }> }
) {
  try {
    const { tournamentReferenceId } = await params;

    const tournament = await getTournamentByRef(tournamentReferenceId);

    if (!tournament) {
      return NextResponse.json(
        { error: "Tournament not found" },
        { status: 404 }
      );
    }

    // Search mode — early return with just search results
    const searchQuery = request.nextUrl.searchParams.get("search");
    if (searchQuery && searchQuery.trim()) {
      const results = await searchTournamentParticipants(
        tournament.id,
        searchQuery.trim()
      );
      return NextResponse.json({ success: true, searchResults: results });
    }

    // Auto-complete if expired
    const wasAutoCompleted = await autoCompleteTournamentIfExpired(tournament);
    if (wasAutoCompleted) {
      notifyTournamentEvent({
        event: "tournament_ended",
        tournamentReferenceId,
      });
    }

    // Re-fetch if status changed
    const freshTournament = wasAutoCompleted
      ? await getTournamentByRef(tournamentReferenceId)
      : tournament;

    if (!freshTournament) {
      return NextResponse.json(
        { error: "Tournament not found" },
        { status: 404 }
      );
    }

    // Resolve current user's participation + rank
    let isParticipant = false;
    let currentUserParticipant = null;
    const { userId: clerkUserId } = await auth();
    if (clerkUserId) {
      const dbUser = await prisma.user.findUnique({
        where: { googleId: clerkUserId },
        select: { id: true },
      });
      if (dbUser) {
        currentUserParticipant = await getCurrentUserParticipant(
          freshTournament.id,
          dbUser.id
        );
        isParticipant = !!currentUserParticipant;
      }
    }

    // Get active games in this tournament
    const activeGames = await prisma.game.findMany({
      where: {
        tournamentId: freshTournament.id,
        status: "IN_PROGRESS",
      },
      include: {
        creator: {
          select: { referenceId: true, name: true, profilePictureUrl: true },
        },
        opponent: {
          select: { referenceId: true, name: true, profilePictureUrl: true },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        ...serializeTournament(freshTournament),
        isParticipant,
        currentUserParticipant,
        activeGames: activeGames.map((g) => ({
          referenceId: g.referenceId,
          creator: g.creator,
          opponent: g.opponent,
          startedAt: g.startedAt?.toISOString() ?? null,
        })),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch tournament" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentReferenceId: string }> }
) {
  try {
    // Protected by a secret token — only e2e tests / CI can call this
    const secret = process.env.E2E_CLEANUP_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "Not configured" }, { status: 404 });
    }

    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { tournamentReferenceId } = await params;

    const tournament = await prisma.tournament.findUnique({
      where: { referenceId: tournamentReferenceId },
    });

    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    // Delete in order: games → tournament (participants cascade)
    await prisma.$transaction(async (tx) => {
      // Delete all games in the tournament
      await tx.game.deleteMany({
        where: { tournamentId: tournament.id },
      });

      // Delete tournament (cascade deletes participants)
      await tx.tournament.delete({
        where: { id: tournament.id },
      });
    });

    logger.info(`Tournament ${tournamentReferenceId} deleted via cleanup API`);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Error deleting tournament", error);
    return NextResponse.json(
      { error: "Failed to delete tournament" },
      { status: 500 }
    );
  }
}
