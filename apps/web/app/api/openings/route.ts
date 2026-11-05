// GET /api/openings (plan §7.4 A4, P1-20, CA AP-28). Public and CDN-cached (public-static, tag "openings"): no
// viewer read, no limiter, no Clerk middleware (1B·F4c lists it in NO_CLERK_API). The rows come from Next's data
// cache (24 h, tag "openings"); the ETag is computed once with the cached data, so a warm CDN miss runs 0 statements.
// Temporary shape: P8's versioned catalogue replaces it (CC R-15).
import { catalogEndpoints } from "@repo/contracts/http/registry";
import type { OpeningsIndexData } from "@repo/contracts/http/openings";
import { cachedData } from "@/lib/api/context";
import { strongEtag } from "@/lib/api/etag";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { serialize } from "@/lib/api/serialize";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CACHE_KEY = ["openings-index:v1"];
const CACHE_TAGS = ["openings"];
const REVALIDATE_SEC = 86_400;

async function loadOpeningsIndex(): Promise<{ data: OpeningsIndexData; etag: string }> {
  const rows = await prisma.opening.findMany({
    where: { isActive: true },
    select: { referenceId: true, eco: true, name: true },
    orderBy: [{ eco: "asc" }, { name: "asc" }],
  });
  const data: OpeningsIndexData = { openings: rows.map((o) => ({ id: o.referenceId, eco: o.eco, name: o.name })) };
  return { data, etag: strongEtag(serialize({ data }, { mode: "strict" })) };
}

export const GET = route(catalogEndpoints.openingsIndex, async () => {
  const index = await cachedData(loadOpeningsIndex, CACHE_KEY, { tags: CACHE_TAGS, revalidate: REVALIDATE_SEC })();
  return respondWith(index.data, { etag: index.etag });
});
