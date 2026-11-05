// GET /api/healthcheck (plan §7.4 A2): plain-text "ok" for existing monitors. Alias of /api/health; deleted in P11.
import { systemEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";

export const dynamic = "force-dynamic";

export const GET = route(systemEndpoints.healthcheck, async () => "ok" as const);
