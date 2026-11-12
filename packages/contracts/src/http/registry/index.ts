// The endpoint registry (plan §7.3). One file per area; a later phase adds registry/<area>.ts and one import plus one
// spread line here (CF §7). Server and test code import the objects; client code imports types only.
import type { EndpointDef } from "../endpoint";
import { archiveEndpoints } from "./archive";
import { billingEndpoints } from "./billing";
import { catalogEndpoints } from "./catalog";
import { gamesEndpoints } from "./games";
import { meEndpoints } from "./me";
import { practiceEndpoints } from "./practice";
import { realtimeEndpoints } from "./realtime";
import { reviewEndpoints } from "./review";
import { shareEndpoints } from "./share";
import { systemEndpoints } from "./system";
import { webhookEndpoints } from "./webhooks";

export { billingEndpoints, catalogEndpoints, gamesEndpoints, meEndpoints, realtimeEndpoints, systemEndpoints, webhookEndpoints };
export { reviewEndpoints };
export { archiveEndpoints, practiceEndpoints, shareEndpoints };

/** Areas by name, as the OpenAPI generator tags them. Keys match the file names in this directory. */
export const REGISTRY_AREAS = {
  archive: archiveEndpoints,
  billing: billingEndpoints,
  catalog: catalogEndpoints,
  games: gamesEndpoints,
  me: meEndpoints,
  practice: practiceEndpoints,
  realtime: realtimeEndpoints,
  review: reviewEndpoints,
  share: shareEndpoints,
  system: systemEndpoints,
  webhooks: webhookEndpoints,
} as const;

type AreaEntries = { [A in keyof typeof REGISTRY_AREAS]: (typeof REGISTRY_AREAS)[A][keyof (typeof REGISTRY_AREAS)[A]] };
export type HttpEndpoint = AreaEntries[keyof AreaEntries];
export type EndpointId = HttpEndpoint["id"];
export type EndpointById<I extends EndpointId> = Extract<HttpEndpoint, { id: I }>;

export const HTTP_ENDPOINTS: readonly HttpEndpoint[] = Object.values(REGISTRY_AREAS).flatMap(
  (area) => Object.values(area) as HttpEndpoint[],
);

const BY_ID = new Map<string, EndpointDef>(HTTP_ENDPOINTS.map((e) => [e.id, e]));

/** The entry for an id. Throws for an unknown id (a typo is a programming error). */
export function getEndpoint<I extends EndpointId>(id: I): EndpointById<I> {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`Unknown endpoint id "${id}"`);
  return entry as EndpointById<I>;
}

/** The area name an entry is declared in. */
export function areaOf(id: string): keyof typeof REGISTRY_AREAS | undefined {
  for (const [area, entries] of Object.entries(REGISTRY_AREAS)) {
    if (Object.values(entries).some((e: EndpointDef) => e.id === id)) return area as keyof typeof REGISTRY_AREAS;
  }
  return undefined;
}
