// Phase 3 redirects (phase-03 plan §3.2 next.config row, §2.4): `/review` (the nav item's old target) opens the
// archive `/games`, where every review starts. `/review/<ref>` is untouched (only the exact path matches). 308 in
// production, 307 elsewhere (P8 D8-5 pattern), so a dev browser does not cache a redirect to a page that is still
// behind the `review-v3` flag. The `/analysis/<ref>` redirect needs a database lookup and is a route handler (H3).

/**
 * @param {Record<string, string | undefined>} env
 * @returns {import("next/dist/lib/load-custom-routes").Redirect[]}
 */
export function redirects(env) {
  return [{ source: "/review", destination: "/games", permanent: env.APP_ENV === "production" }];
}
