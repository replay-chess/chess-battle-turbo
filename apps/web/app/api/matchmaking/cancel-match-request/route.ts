import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cancelMatchRequest } from "@/lib/services/matchmaking";
import { resolveUser } from "@/lib/auth/resolve-user";
import { logger } from "@/lib/logger";

const cancelMatchRequestSchema = z.object({
  queueReferenceId: z.string().min(1, "Queue reference ID is required"),
});

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = cancelMatchRequestSchema.parse(body);

    const result = await cancelMatchRequest(
      validatedData.queueReferenceId,
      user.referenceId
    );

    // All results are successful (idempotent operation)
    return NextResponse.json({
      success: true,
      message: "Match request cancelled",
      data: result,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
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
      if (error.message === "User not found") {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 404 }
        );
      }
      if (error.message === "Unauthorized") {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 403 }
        );
      }
    }

    logger.error("Error cancelling match request", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to cancel match request",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
