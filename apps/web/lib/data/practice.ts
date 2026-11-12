// The practice DAL for server components (phase-03 plan §5.9). Server-only; read only (no writes, nothing enqueued).
// The `/practice` page parses its searchParams with `PracticeQuery` (a 400 page for an illegal FEN) and calls this.
import "server-only";
import { cache } from "react";
import type { PracticeContextDTO, PracticeTarget } from "@repo/contracts/http/practice";
import type { Viewer } from "@/lib/auth/viewer";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { getPracticeContext as readPracticeContext } from "@/lib/services/analysis/practice";

export { DataError, isNotFound } from "./errors";

/**
 * PracticeContextDTO for one source. Throws DataError not_found (an unknown or unfinished game, a non-player, an unknown
 * position) and ApiError validation_failed (`details.reason: "illegal_position"`, or a ply out of range).
 */
export const getPracticeContext = cache(
  async (viewer: Viewer, target: PracticeTarget): Promise<PracticeContextDTO> =>
    readPracticeContext(rawDb(prisma), viewer, target),
);
