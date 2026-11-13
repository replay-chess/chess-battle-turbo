import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { getViewer } from "@/lib/auth/viewer";
import { getFlags } from "@/lib/flags";
import { LEGACY_NOT_FOUND_BODY, legacyChessComDecision, limitLegacyLookup } from "@/lib/onboarding/legacy-chesscom";
import { clientIpFrom } from "@/lib/rate-limit-db";
import {
  fetchChessComProfile,
  fetchChessComStats,
  extractCountryCode,
} from "@/lib/chess-com";

const chessComProfileSchema = z.object({
  chessComHandle: z.string().min(1, "Chess.com username is required").max(50),
});

/**
 * POST /api/user/chess-com-profile
 * Save user's chess.com profile and fetch their stats
 * Legacy (phase-04 plan §3 row 180, §7.12): 404 once both v3 flags are on for the viewer; the `onboarded` write happens
 * only for the legacy onboarding page (`onboarding-v3` off); every request spends the lookup buckets first
 * (lib/onboarding/legacy-chesscom.ts, FIX-2).
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized - User not authenticated" },
        { status: 401 }
      );
    }

    const decision = legacyChessComDecision(await getFlags(await getViewer()));
    if (decision.kind === "not_found") {
      return NextResponse.json(LEGACY_NOT_FOUND_BODY, { status: 404 });
    }

    const body = await req.json();
    const validatedData = chessComProfileSchema.parse(body);
    const chessComHandle = validatedData.chessComHandle.toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { googleId: userId },
      include: { chessComProfile: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found in database" },
        { status: 404 }
      );
    }

    const limit = await limitLegacyLookup({ clerkUserId: userId, ip: clientIpFrom(req.headers) });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
      );
    }

    logger.debug(`Fetching chess.com data for: ${chessComHandle}`);

    const [profileData, statsData] = await Promise.all([
      fetchChessComProfile(chessComHandle),
      fetchChessComStats(chessComHandle),
    ]);

    const rapidData = statsData.chess_rapid;
    const blitzData = statsData.chess_blitz;
    const bulletData = statsData.chess_bullet;
    const dailyData = statsData.chess_daily;

    const profilePayload = {
      chessComHandle,

      // Profile fields
      displayName: profileData.name ?? null,
      avatar: profileData.avatar ?? null,
      title: profileData.title ?? null,
      country: extractCountryCode(profileData.country ?? null),
      status: profileData.status ?? null,
      followers: profileData.followers ?? null,
      isStreamer: profileData.is_streamer ?? false,
      joined: profileData.joined
        ? new Date(profileData.joined * 1000)
        : null,

      // Rapid stats
      rapidRating: rapidData?.last?.rating ?? null,
      rapidBestRating: rapidData?.best?.rating ?? null,
      rapidWins: rapidData?.record?.win ?? null,
      rapidLosses: rapidData?.record?.loss ?? null,
      rapidDraws: rapidData?.record?.draw ?? null,

      // Blitz stats
      blitzRating: blitzData?.last?.rating ?? null,
      blitzBestRating: blitzData?.best?.rating ?? null,
      blitzWins: blitzData?.record?.win ?? null,
      blitzLosses: blitzData?.record?.loss ?? null,
      blitzDraws: blitzData?.record?.draw ?? null,

      // Bullet stats
      bulletRating: bulletData?.last?.rating ?? null,
      bulletBestRating: bulletData?.best?.rating ?? null,
      bulletWins: bulletData?.record?.win ?? null,
      bulletLosses: bulletData?.record?.loss ?? null,
      bulletDraws: bulletData?.record?.draw ?? null,

      // Daily stats
      dailyRating: dailyData?.last?.rating ?? null,
      dailyBestRating: dailyData?.best?.rating ?? null,
      dailyWins: dailyData?.record?.win ?? null,
      dailyLosses: dailyData?.record?.loss ?? null,
      dailyDraws: dailyData?.record?.draw ?? null,

      lastSyncedAt: new Date(),
    };

    const isNewProfile = !user.chessComProfile;

    // Upsert chess.com profile and, for the legacy onboarding page only, mark the user as onboarded in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const chessComProfile = await tx.chessComProfile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...profilePayload },
        update: profilePayload,
      });

      if (decision.markOnboarded) {
        await tx.user.update({
          where: { id: user.id },
          data: { onboarded: true },
        });
      }

      return chessComProfile;
    });

    logger.debug(
      `Chess.com profile ${isNewProfile ? "created" : "updated"} for user ${user.referenceId}`
    );

    return NextResponse.json(
      {
        success: true,
        message: `Chess.com profile ${isNewProfile ? "connected" : "updated"} successfully`,
        profile: {
          referenceId: result.referenceId,
          chessComHandle: result.chessComHandle,
          rapidRating: result.rapidRating,
          blitzRating: result.blitzRating,
        },
      },
      { status: isNewProfile ? 201 : 200 }
    );
  } catch (error) {
    logger.error("Error saving chess.com profile", error);

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

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
