import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TournamentStatus } from "@repo/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as TournamentStatus | null;
    const statuses = searchParams.get("statuses");
    const countOnly = searchParams.get("count") === "true";

    let where: Record<string, unknown> = {};
    if (status) {
      where = { status };
    } else if (statuses) {
      where = { status: { in: statuses.split(",") } };
    }

    if (countOnly) {
      const count = await prisma.tournament.count({ where });
      return NextResponse.json({ success: true, data: { count } });
    }

    const tournaments = await prisma.tournament.findMany({
      where,
      include: {
        createdBy: {
          select: { referenceId: true, name: true, profilePictureUrl: true },
        },
        _count: { select: { participants: true, games: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({
      success: true,
      data: {
        tournaments: tournaments.map((t) => ({
          referenceId: t.referenceId,
          name: t.name,
          mode: t.mode,
          status: t.status,
          maxParticipants: t.maxParticipants,
          initialTimeSeconds: t.initialTimeSeconds,
          incrementSeconds: t.incrementSeconds,
          durationMinutes: t.durationMinutes,
          scheduledStartAt: t.scheduledStartAt.toISOString(),
          startedAt: t.startedAt?.toISOString() ?? null,
          endsAt: t.endsAt?.toISOString() ?? null,
          completedAt: t.completedAt?.toISOString() ?? null,
          createdAt: t.createdAt.toISOString(),
          createdBy: t.createdBy,
          participantCount: t._count.participants,
          gameCount: t._count.games,
        })),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch tournaments" },
      { status: 500 }
    );
  }
}
