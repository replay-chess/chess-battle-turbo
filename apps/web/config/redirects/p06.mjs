// Phase 6 redirects (phase-06 plan §4.1, §3.1 next.config row; inv-pub §2): `/weakness` (the landing's "Your Patterns"
// CTA) opens the Weakness Profile. 307 on dev and every non-production build, 308 only in production (P13): a browser
// caches a 308 for good, and the page is still behind the `weakness` flag. Signed out, the target's own gate then
// sends the visitor to sign in; with the flag off, the page itself redirects to /train (no dead link). Only the exact
// path matches.

/**
 * @param {Record<string, string | undefined>} env
 * @returns {import("next/dist/lib/load-custom-routes").Redirect[]}
 */
export function redirects(env) {
  return [{ source: "/weakness", destination: "/train/weakness", permanent: env.APP_ENV === "production" }];
}
