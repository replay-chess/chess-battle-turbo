import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@repo/db";
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/auth/require-admin";

const createLegendSchema = z.object({
  name: z.string().min(1, "Name is required"),
  era: z.string().min(1, "Era is required"),
  profilePhotoUrl: z.string().url("Must be a valid URL").optional().nullable(),
  peakRating: z.number().int().positive().optional().nullable(),
  nationality: z.string().optional().nullable(),
  shortDescription: z.string().min(1, "Short description is required").max(500),
  playingStyle: z.string().optional().nullable(),
  birthYear: z.number().int().min(1000).max(9999).optional().nullable(),
  deathYear: z.number().int().min(1000).max(9999).optional().nullable(),
  achievements: z.array(z.string()).optional().nullable(),
  famousGames: z.array(z.object({
    fen: z.string(),
    description: z.string().optional(),
  })).optional().nullable(),
  isActive: z.boolean().default(true),
  isVisible: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.error) return admin.error;

  try {
    const body = await request.json();
    logger.debug("Received legend data: " + JSON.stringify(body));
    const validatedData = createLegendSchema.parse(body);
    logger.debug("Validated data: " + JSON.stringify(validatedData));

    // Create the legend
    const legend = await prisma.legend.create({
      data: {
        name: validatedData.name,
        era: validatedData.era,
        profilePhotoUrl: validatedData.profilePhotoUrl || null,
        peakRating: validatedData.peakRating || null,
        nationality: validatedData.nationality || null,
        shortDescription: validatedData.shortDescription,
        playingStyle: validatedData.playingStyle || null,
        birthYear: validatedData.birthYear || null,
        deathYear: validatedData.deathYear || null,
        achievements: validatedData.achievements ? validatedData.achievements : Prisma.JsonNull,
        famousGames: validatedData.famousGames ? validatedData.famousGames : Prisma.JsonNull,
        isActive: validatedData.isActive,
        isVisible: validatedData.isVisible,
      },
    });

    logger.info("Legend created successfully: " + legend.id);

    return NextResponse.json(
      {
        success: true,
        message: "Legend created successfully",
        data: {
          legend: {
            id: legend.id.toString(),
            referenceId: legend.referenceId,
            name: legend.name,
            era: legend.era,
            createdAt: legend.createdAt,
          },
        },
      },
      { status: 201 }
    );
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

    // Handle unique constraint violation
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return NextResponse.json(
          { error: "A legend with this name already exists" },
          { status: 400 }
        );
      }
    }

    logger.error("Error creating legend", error);
    return NextResponse.json(
      {
        error: "Failed to create legend",
      },
      { status: 500 }
    );
  }
}
