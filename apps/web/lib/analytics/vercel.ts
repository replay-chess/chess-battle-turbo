// Vercel Web Analytics and Speed Insights load their scripts from `/_vercel/*`, which only Vercel serves.
// On any other host (`next start` in CI and locally, the e2e servers) those URLs answer the HTML 404 page and
// the browser logs "Refused to execute script … MIME type ('text/html')" on every page, which the e2e console
// guard rightly counts as errors. Vercel sets `VERCEL=1` at build and run time on every deployment (dev and
// production alike).
//
// Even on Vercel, `/_vercel/insights/script.js` exists only when Web Analytics is enabled on the project: on the
// `replay-chess-dev` project it is not, and every page logged two console errors (404 + refused MIME type; dev pass
// D7). So Web Analytics also needs the project to say it is on: `VERCEL_WEB_ANALYTICS=1` (set it in the Vercel
// project's env together with enabling Web Analytics in its dashboard). Speed Insights keeps the Vercel-only rule.
type Env = Record<string, string | undefined>;

/** Speed Insights (`/_vercel/speed-insights/script.js`): every Vercel deployment. */
export function vercelAnalyticsEnabled(env: Env = process.env): boolean {
  return env.VERCEL === "1";
}

/** Web Analytics (`/_vercel/insights/script.js`): a Vercel deployment whose project has it enabled. */
export function vercelWebAnalyticsEnabled(env: Env = process.env): boolean {
  return vercelAnalyticsEnabled(env) && env.VERCEL_WEB_ANALYTICS === "1";
}
