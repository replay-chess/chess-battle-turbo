import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { fetchChessComPreview } from "@/lib/chess-com";
import { getViewer } from "@/lib/auth/viewer";
import { getFlags } from "@/lib/flags";
import { LEGACY_NOT_FOUND_BODY, legacyChessComDecision, limitLegacyLookup } from "@/lib/onboarding/legacy-chesscom";
import { clientIpFrom } from "@/lib/rate-limit-db";

const previewSchema = z.object({
  chessComHandle: z.string().min(1, "Chess.com username is required").max(50),
});

/**
 * POST /api/user/chess-com-profile/preview
 * Fetches chess.com profile + stats for preview without saving to DB
 * Legacy (phase-04 plan §3 row 179, §7.12): 404 once both v3 flags are on for the viewer; otherwise it spends ACC-2's
 * lookup buckets (10 / 60 s per user, 30 / 60 s per IP, plan §11.2) before it calls Chess.com (FIX-2).
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

    if (legacyChessComDecision(await getFlags(await getViewer())).kind === "not_found") {
      return NextResponse.json(LEGACY_NOT_FOUND_BODY, { status: 404 });
    }

    const body = await req.json();
    const validatedData = previewSchema.parse(body);
    const handle = validatedData.chessComHandle.toLowerCase().trim();

    const limit = await limitLegacyLookup({ clerkUserId: userId, ip: clientIpFrom(req.headers) });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
      );
    }

    const previewData = await fetchChessComPreview(handle);

    return NextResponse.json({ success: true, data: previewData });
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

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
