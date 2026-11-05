// GET /api/health (plan §7.4 A1). Public liveness with the build id. `?deep=1` also runs `SELECT 1` (the only path
// that wakes Neon) and is rate-limited per IP (bucket health-deep, 6 / 60 s); the plain call touches nothing.
import { systemEndpoints } from "@repo/contracts/http/registry";
import { ApiError } from "@/lib/api/api-error";
import { appEnvName, serverBuildId } from "@/lib/api/context";
import { route } from "@/lib/api/route";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = route(
  { ...systemEndpoints.health, rateLimitWhen: (ctx) => ctx.rawQuery.deep === "1" },
  async (ctx) => {
    const base = { ok: true as const, buildId: serverBuildId(), env: appEnvName(), time: ctx.now.toISOString() };
    if (ctx.query.deep !== "1") return base;

    const started = performance.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      const ms = Math.round((performance.now() - started) * 10) / 10;
      throw new ApiError("unavailable", { retryAfterSec: 2, details: { db: { ok: false, ms } }, cause: err });
    }
    const ms = Math.round((performance.now() - started) * 10) / 10;
    return { ...base, db: { ok: true, ms } };
  },
);
