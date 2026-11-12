import { defineEndpoint } from "../endpoint";
import { PracticeContextDTO, PracticeQuery } from "../practice";

/**
 * Phase-03 plan §7.2 PR1 (§5.9). Handler: WEB/app/api/practice/context/route.ts (WP-D). The `/practice` RSC calls the
 * DAL directly; this route serves client callers outside it (P5's "study this position"). Member only; `?game=` also
 * needs the viewer to be a player (404 otherwise, admins read). Nothing is written.
 */
export const practiceEndpoints = {
  context: defineEndpoint({
    id: "practice.context",
    method: "GET",
    path: "/api/practice/context",
    auth: "member",
    class: "R1",
    cache: "private-etag",
    query: PracticeQuery,
    response: PracticeContextDTO,
    errors: ["not_found"],
    summary: "The start position and copy of a practice session",
  }),
} as const;
