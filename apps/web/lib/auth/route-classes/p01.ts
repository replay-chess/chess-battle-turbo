// Phase 1 route classes (plan phase-01 §7.6). Written from REPO/docs/route-map.md §3, then hand-maintained; pure data.
//
// Pattern syntax (compiled by ./index.ts):
// - "/x"        exactly /x (a trailing slash is ignored);
// - "/x(.*)"    /x itself or anything below it (/x/…). Never a longer segment: "/play(.*)" does not match /playlist,
//               and "/join(.*)" does not match /join-tournament;
// - "/x/(.*)"   anything below /x, but not /x itself.
//
// A later phase never edits this file to change a class: it adds `pNN.ts` with the same four lists and one import line
// in ./index.ts. The newest phase that lists a path decides its class (route-map.md §5).
//
// Deviations from the plan's sketch (route-map.md §3 lists the concrete paths):
// - "/sitemap(.*)" is spelled "/sitemap.xml" + "/sitemap/(.*)": with segment-boundary matching, "/sitemap(.*)" would
//   not cover /sitemap.xml.
// - "/api/scraper(.*)" is NOT in noClerkApi: its handler falls back to requireAdmin(), which calls Clerk's auth(), and
//   auth() throws when Clerk middleware did not run (signed out would get a 500 instead of the 401 the walker expects).

export const publicPages: readonly string[] = [
  "/",
  "/about",
  "/blog(.*)",
  "/careers",
  "/community",
  "/contact",
  "/cookies",
  "/docs(.*)",
  "/help(.*)",
  "/learn(.*)",
  "/legends(.*)",
  "/openings(.*)",
  "/og(.*)",
  "/press",
  "/pricing",
  "/privacy",
  "/terms",
  "/profile/(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/too-many-requests",
  "/dev(.*)",
  "/sitemap.xml",
  "/sitemap/(.*)",
  "/sitemap-legends.xml",
  "/sitemap-openings.xml",
  "/robots.txt",
  "/manifest.json",
];

export const memberPages: readonly string[] = [
  "/play(.*)",
  "/queue(.*)",
  "/challenge(.*)",
  "/join(.*)",
  "/join-tournament(.*)",
  "/position(.*)",
  "/tournaments(.*)",
  "/tournament(.*)",
  "/game(.*)",
  "/analysis(.*)",
];

export const signedInPages: readonly string[] = ["/onboarding(.*)", "/admin(.*)", "/checkout(.*)"];

/** API paths that verify themselves (signature, bearer secret) or are public and CDN-cached: Clerk never runs. */
export const noClerkApi: readonly string[] = [
  "/api/webhook(.*)",
  "/api/cron(.*)",
  "/api/health",
  "/api/healthcheck",
  "/api/openings",
];
