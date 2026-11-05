import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma";
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/auth/require-admin";

const updateLegendSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  era: z.string().min(1, "Era is required").optional(),
  profilePhotoUrl: z.string().url("Must be a valid URL").optional().nullable(),
  peakRating: z.number().int().positive().optional().nullable(),
  nationality: z.string().optional().nullable(),
  shortDescription: z.string().min(1, "Short description is required").max(500).optional(),
  playingStyle: z.string().optional().nullable(),
  birthYear: z.number().int().min(1000).max(9999).optional().nullable(),
  deathYear: z.number().int().min(1000).max(9999).optional().nullable(),
  achievements: z.array(z.string()).optional().nullable(),
  famousGames: z.array(z.object({
    fen: z.string(),
    description: z.string().optional(),
  })).optional().nullable(),
  isActive: z.boolean().optional(),
  isVisible: z.boolean().optional(),
});


export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin.error) return admin.error;

  try {
    const { id } = await params;
    const body = await request.json();
    const validatedData = updateLegendSchema.parse(body);

    // Check if legend exists - try referenceId first, then BigInt id
    let existingLegend = await prisma.legend.findUnique({
      where: { referenceId: id }
    });

    // Fallback to BigInt id if referenceId not found
    if (!existingLegend) {
      try {
        const legendId = BigInt(id);
        existingLegend = await prisma.legend.findUnique({
          where: { id: legendId }
        });
      } catch {
        // Invalid BigInt, legend not found
      }
    }

    if (!existingLegend) {
      return NextResponse.json(
        { error: "Legend not found" },
        { status: 404 }
      );
    }

    // If name is being changed, check for duplicates
    if (validatedData.name && validatedData.name !== existingLegend.name) {
      const duplicateName = await prisma.legend.findFirst({
        where: {
          name: validatedData.name,
          id: { not: existingLegend.id }
        }
      });

      if (duplicateName) {
        return NextResponse.json(
          { error: "A legend with this name already exists" },
          { status: 400 }
        );
      }
    }

    // Prepare update data with proper JSON handling
    // Using explicit type assertion due to complex Prisma JSON handling
    const updateData: Record<string, unknown> = { ...validatedData };
    if ('achievements' in updateData) {
      updateData.achievements = updateData.achievements ? updateData.achievements : Prisma.JsonNull;
    }
    if ('famousGames' in updateData) {
      updateData.famousGames = updateData.famousGames ? updateData.famousGames : Prisma.JsonNull;
    }

    // Update the legend
    const legend = await prisma.legend.update({
      where: { id: existingLegend.id },
      data: updateData,
    });

    return NextResponse.json(
      {
        success: true,
        message: "Legend updated successfully",
        data: {
          legend: {
            id: legend.id.toString(),
            referenceId: legend.referenceId,
            name: legend.name,
            era: legend.era,
            updatedAt: legend.updatedAt,
          },
        },
      },
      { status: 200 }
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

    logger.error("Error updating legend", error);
    return NextResponse.json(
      {
        error: "Failed to update legend",
      },
      { status: 500 }
    );
  }
}

// GET single legend by ID
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Try referenceId first, then BigInt id
    let legend = await prisma.legend.findUnique({
      where: { referenceId: id }
    });

    if (!legend) {
      try {
        const legendId = BigInt(id);
        legend = await prisma.legend.findUnique({
          where: { id: legendId }
        });
      } catch {
        // Invalid BigInt, legend not found
      }
    }

    if (!legend) {
      return NextResponse.json(
        { error: "Legend not found" },
        { status: 404 }
      );
    }

    // Convert BigInt to string for JSON serialization
    const legendWithStringId = {
      ...legend,
      id: legend.id.toString(),
    };

    return NextResponse.json(
      {
        success: true,
        data: { legend: legendWithStringId },
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error("Error fetching legend", error);
    return NextResponse.json(
      {
        error: "Failed to fetch legend",
      },
      { status: 500 }
    );
  }
}

// DELETE legend by ID
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin.error) return admin.error;

  try {
    const { id } = await params;

    // Try referenceId first, then BigInt id
    let existingLegend = await prisma.legend.findUnique({
      where: { referenceId: id },
      include: {
        _count: {
          select: {
            gamesAsWhite: true,
            gamesAsBlack: true,
          },
        },
      },
    });

    if (!existingLegend) {
      try {
        const legendId = BigInt(id);
        existingLegend = await prisma.legend.findUnique({
          where: { id: legendId },
          include: {
            _count: {
              select: {
                gamesAsWhite: true,
                gamesAsBlack: true,
              },
            },
          },
        });
      } catch {
        // Invalid BigInt, legend not found
      }
    }

    if (!existingLegend) {
      return NextResponse.json(
        { error: "Legend not found" },
        { status: 404 }
      );
    }

    const totalGames = existingLegend._count.gamesAsWhite + existingLegend._count.gamesAsBlack;

    // Delete the legend (FK constraints will automatically set chess_positions references to NULL)
    await prisma.legend.delete({
      where: { id: existingLegend.id },
    });

    return NextResponse.json(
      {
        success: true,
        message: "Legend deleted successfully",
        data: {
          deletedLegend: {
            id: existingLegend.id.toString(),
            referenceId: existingLegend.referenceId,
            name: existingLegend.name,
            gamesAffected: totalGames,
          },
        },
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error("Error deleting legend", error);
    return NextResponse.json(
      {
        error: "Failed to delete legend",
      },
      { status: 500 }
    );
  }
}
