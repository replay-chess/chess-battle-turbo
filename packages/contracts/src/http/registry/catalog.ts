import { defineEndpoint } from "../endpoint";
import { OpeningsIndexData } from "../openings";

export const catalogEndpoints = {
  /** A4. Public and CDN-cached; temporary until P8's versioned catalogue (CC R-15). */
  openingsIndex: defineEndpoint({
    id: "catalog.openings.index",
    method: "GET",
    path: "/api/openings",
    auth: "public",
    class: "P",
    cache: "public-static",
    publicStatic: { sMaxAge: 86_400, swr: 604_800, tags: ["openings"] },
    response: OpeningsIndexData,
    summary: "Every active opening: id, ECO code and name",
  }),
} as const;
