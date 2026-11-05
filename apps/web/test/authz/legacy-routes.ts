// Route files that are not route() yet, with the status a signed-out caller gets (plan §7.4 closing paragraph, §12.2).
// test/authz/walker.test.ts fails when an app/api/**/route.ts export is neither a route() handler nor listed here,
// and when a row here no longer matches a file. With AUTHZ_BASE_URL set it calls every row signed out and asserts
// the status. When a route moves onto route(), delete its row (the contract tests take over).
//
// Statuses were taken signed out against `next dev` on the Neon dev branch (2026-11-05). Dynamic segments are
// probed with an id that does not exist, so public detail reads answer 404.

export type LegacyRoute = {
  /** Relative to apps/web. */
  file: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Signed out, with `{}` as the JSON body for writes and the probe query below. */
  anonymous: 200 | 400 | 401 | 403 | 404;
  /** Signed in without admin or membership (the access matrix, plan §11.1); checked by e2e/specs/security.spec.ts. */
  signedInNonAdmin?: 200 | 401 | 402 | 403 | 404;
  /** Query appended when probing. */
  query?: string;
  /** Other statuses that are correct in a given environment, with the reason. */
  alsoAccept?: { status: number; when: string }[];
  /** Owning package or phase that moves it onto route(). */
  owner: string;
};

export const LEGACY_ROUTES: readonly LegacyRoute[] = [
  { file: "app/api/analysis/[gameId]/route.ts", method: "GET", anonymous: 401, owner: "P3" },
  { file: "app/api/checkout/route.ts", method: "POST", anonymous: 401, owner: "P4/P10" },
  { file: "app/api/chess-positions/[id]/route.ts", method: "GET", anonymous: 401, signedInNonAdmin: 403, owner: "P12" },
  { file: "app/api/chess-positions/[id]/route.ts", method: "PUT", anonymous: 401, signedInNonAdmin: 403, owner: "P12" },
  { file: "app/api/chess-positions/[id]/route.ts", method: "DELETE", anonymous: 401, signedInNonAdmin: 403, owner: "P12" },
  { file: "app/api/chess-positions/create/route.ts", method: "POST", anonymous: 401, signedInNonAdmin: 403, owner: "P12" },
  { file: "app/api/chess-positions/featured/route.ts", method: "GET", anonymous: 200, owner: "P8" },
  { file: "app/api/chess-positions/route.ts", method: "GET", anonymous: 401, signedInNonAdmin: 403, owner: "P12" },
  { file: "app/api/chess/cancel-game/route.ts", method: "POST", anonymous: 401, owner: "P2" },
  { file: "app/api/chess/create-ai-game/route.ts", method: "POST", anonymous: 401, signedInNonAdmin: 402, owner: "P2 (deleted)" },
  { file: "app/api/chess/create-game/route.ts", method: "POST", anonymous: 401, signedInNonAdmin: 402, owner: "P2" },
  // optional + internal (H4): unknown ref → 404; a real ref → the invite projection (200).
  { file: "app/api/chess/game-by-ref/[gameReferenceId]/route.ts", method: "GET", anonymous: 404, owner: "P2" },
  { file: "app/api/chess/game-over/route.ts", method: "POST", anonymous: 401, signedInNonAdmin: 403, owner: "P2" },
  { file: "app/api/chess/game-state/route.ts", method: "POST", anonymous: 401, signedInNonAdmin: 403, owner: "P2" },
  { file: "app/api/chess/join/route.ts", method: "POST", anonymous: 401, signedInNonAdmin: 402, owner: "P2" },
  { file: "app/api/chess/move/route.ts", method: "POST", anonymous: 401, signedInNonAdmin: 403, owner: "P2" },
  // Standalone until it moves onto route({ ...systemEndpoints.cronDaily }) (F5 follow-up); bearer only.
  { file: "app/api/cron/daily/route.ts", method: "GET", anonymous: 401, owner: "1B·F5" },
  { file: "app/api/customer-portal/route.ts", method: "GET", anonymous: 401, owner: "P10" },
  { file: "app/api/legends/[id]/route.ts", method: "GET", anonymous: 404, owner: "P8" },
  { file: "app/api/legends/[id]/route.ts", method: "PUT", anonymous: 401, signedInNonAdmin: 403, owner: "P12" },
  { file: "app/api/legends/[id]/route.ts", method: "DELETE", anonymous: 401, signedInNonAdmin: 403, owner: "P12" },
  { file: "app/api/legends/create/route.ts", method: "POST", anonymous: 401, signedInNonAdmin: 403, owner: "P12" },
  { file: "app/api/legends/route.ts", method: "GET", anonymous: 200, owner: "P8" },
  { file: "app/api/legends/search/route.ts", method: "GET", anonymous: 200, query: "?name=morphy", owner: "P8" },
  { file: "app/api/matchmaking/cancel-beacon/route.ts", method: "POST", anonymous: 401, owner: "P9" },
  { file: "app/api/matchmaking/cancel-match-request/route.ts", method: "POST", anonymous: 401, owner: "P9" },
  { file: "app/api/matchmaking/cleanup/route.ts", method: "POST", anonymous: 401, owner: "P9" },
  { file: "app/api/matchmaking/create-match-request/route.ts", method: "POST", anonymous: 401, signedInNonAdmin: 402, owner: "P9" },
  { file: "app/api/matchmaking/match-status/route.ts", method: "GET", anonymous: 401, owner: "P9" },
  { file: "app/api/position/[referenceId]/route.ts", method: "GET", anonymous: 404, owner: "P8" },
  { file: "app/api/profile/[referenceId]/route.ts", method: "GET", anonymous: 404, owner: "P10" },
  { file: "app/api/scraper/positions/import/route.ts", method: "POST", anonymous: 401, signedInNonAdmin: 403, owner: "P12" },
  { file: "app/api/subscription/cancel/route.ts", method: "POST", anonymous: 401, owner: "P10" },
  { file: "app/api/subscription/change-plan/preview/route.ts", method: "POST", anonymous: 401, owner: "P10" },
  { file: "app/api/subscription/change-plan/route.ts", method: "POST", anonymous: 401, owner: "P10" },
  { file: "app/api/subscription/change-plan/route.ts", method: "DELETE", anonymous: 401, owner: "P10" },
  { file: "app/api/subscription/resume/route.ts", method: "POST", anonymous: 401, owner: "P10" },
  // A6: user (legacy handler, DB-only after 1B·F4a).
  { file: "app/api/subscription/route.ts", method: "GET", anonymous: 401, signedInNonAdmin: 200, owner: "P10" },
  { file: "app/api/tournament/[tournamentReferenceId]/route.ts", method: "GET", anonymous: 404, owner: "P12" },
  {
    file: "app/api/tournament/[tournamentReferenceId]/route.ts",
    method: "DELETE",
    anonymous: 401,
    alsoAccept: [{ status: 404, when: "the cleanup bearer secret is unset (local next dev answers 404 'Not configured')" }],
    owner: "P12",
  },
  { file: "app/api/tournament/cancel-search/route.ts", method: "POST", anonymous: 401, owner: "P12" },
  { file: "app/api/tournament/create/route.ts", method: "POST", anonymous: 401, owner: "P12" },
  { file: "app/api/tournament/end/route.ts", method: "POST", anonymous: 401, owner: "P12" },
  { file: "app/api/tournament/find-match/route.ts", method: "POST", anonymous: 401, owner: "P12" },
  { file: "app/api/tournament/join/route.ts", method: "POST", anonymous: 401, owner: "P12" },
  { file: "app/api/tournament/route.ts", method: "GET", anonymous: 200, owner: "P12" },
  { file: "app/api/tournament/start/route.ts", method: "POST", anonymous: 401, owner: "P12" },
  { file: "app/api/user/chess-com-profile/preview/route.ts", method: "POST", anonymous: 401, owner: "P4" },
  { file: "app/api/user/chess-com-profile/route.ts", method: "POST", anonymous: 401, owner: "P4" },
  // H3: only the caller's own row; everything else (incl. signed out) is the same 404. F4d deletes the route.
  { file: "app/api/user/onboarding-skip/route.ts", method: "POST", anonymous: 401, owner: "P4" },
  // A16: deprecated; no caller after F4d; deleted in P2.
  { file: "app/api/user/sync/route.ts", method: "POST", anonymous: 401, owner: "P2 (delete)" },
];
