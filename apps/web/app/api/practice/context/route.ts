// GET /api/practice/context (phase-03 plan §7.2 PR1, §5.9): the start position and copy of a practice session, for
// client callers outside the `/practice` RSC (P5's "study this position"). Member; `?game=` needs the viewer to be a
// player of a finished game (404 otherwise; admins read). `?fen=` is validated (400 validation_failed with
// `details.reason: "illegal_position"`). Read only. `private-etag` (the default body-hash ETag; no max-age, AP-04).
import { practiceTargetOf } from "@repo/contracts/http/practice";
import { practiceEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { getPracticeContext } from "@/lib/services/analysis/practice";

export const dynamic = "force-dynamic";

export const GET = route(practiceEndpoints.context, async (ctx) =>
  getPracticeContext(rawDb(prisma), ctx.viewer!, practiceTargetOf(ctx.query)),
);
