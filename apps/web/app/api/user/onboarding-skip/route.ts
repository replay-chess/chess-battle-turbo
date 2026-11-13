import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getViewer } from "@/lib/auth/viewer";
import { getFlags } from "@/lib/flags";
import { legacySkipDecision } from "@/lib/onboarding/legacy-skip";

/**
 * POST /api/user/onboarding-skip
 * Marks the user as onboarded without connecting a chess.com profile.
 * Legacy (phase-04 plan §7.12): served only while `onboarding-v3` is off for the viewer (lib/onboarding/legacy-skip.ts);
 * with it on, onboarding completes through PATCH /api/me/onboarding and its plan_required check (FIX-1).
 */
export async function POST() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized - User not authenticated" },
        { status: 401 }
      );
    }

    const viewer = await getViewer();
    if (legacySkipDecision(await getFlags(viewer)) === "not_found") {
      return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
    }

    const user = await prisma.user.findUnique({
      where: { googleId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found in database" },
        { status: 404 }
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { onboarded: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Error skipping onboarding", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
