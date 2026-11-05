import { defineEndpoint } from "../endpoint";
import { MeData } from "../me";

export const meEndpoints = {
  /** A3. One getViewer() + getFlags(); provisions a first-time user. */
  get: defineEndpoint({
    id: "me.get",
    method: "GET",
    path: "/api/me",
    auth: "user",
    class: "R1",
    cache: "private-etag",
    sideEffects: ["provision_user"],
    response: MeData,
    errors: ["upstream_unavailable"],
    summary: "The signed-in viewer: user, entitlement, flags and build id",
  }),
} as const;
