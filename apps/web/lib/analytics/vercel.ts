// Vercel Web Analytics and Speed Insights load their scripts from `/_vercel/*`, which only Vercel serves.
// On any other host (`next start` in CI and locally, the e2e servers) those URLs answer the HTML 404 page and
// the browser logs "Refused to execute script … MIME type ('text/html')" on every page, which the e2e console
// guard rightly counts as errors. Vercel sets `VERCEL=1` at build and run time on every deployment (dev and
// production alike), so the components render there and nowhere else.
type Env = Record<string, string | undefined>;

export function vercelAnalyticsEnabled(env: Env = process.env): boolean {
  return env.VERCEL === "1";
}
