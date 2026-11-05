// Catalogue queries (plan §5.3). `qk.catalog.openingsIndex()` → GET /api/openings (public-static, CDN-cached).
// Temporary: P8 CAT-3 replaces the endpoint shape and deletes this query (CC R-15).
import { OpeningsIndexData } from "@repo/contracts/http/openings";
import { queryOptions } from "@tanstack/react-query";
import { api } from "../client";
import { endpoints } from "../endpoints";
import { qk } from "../keys";

const DAY_MS = 24 * 60 * 60_000;

export const openingsIndexQuery = queryOptions({
  queryKey: qk.catalog.openingsIndex(),
  queryFn: async ({ signal }): Promise<OpeningsIndexData> => {
    // devSchema written inline (lib/api/schema.ts): only then does webpack drop the schema, and zod, from production chunks.
    const schema = process.env.NODE_ENV === "production" ? undefined : OpeningsIndexData;
    const { data } = await api(endpoints.openings, { schema, signal });
    return data;
  },
  staleTime: DAY_MS,
  gcTime: DAY_MS,
  refetchOnWindowFocus: false,
  meta: { object: "openings" },
});
