// Lighthouse CI for the public share page `/r/<code>` (phase-03 plan G5 acceptance: "Lighthouse ≥ 95 on /r/[code]";
// FIX-1: nothing checked it). Mobile emulation (Lighthouse's default), 3 runs, median. The code is the live share of
// `packages/db/seed/public-share.ts` (PUBLIC_SHARE_CODE, the same on every database). Run by nightly.yml (job
// `lighthouse-share`) against a local `next build && next start` with the test app env and a seeded local Postgres;
// locally: seed a local database (`pnpm --filter @repo/db seed:public-share --apply`), build, then
// `npx @lhci/cli@0.14.0 autorun --config=lighthouserc.share.cjs` from apps/web.
/* global module */
const PUBLIC_SHARE_CODE = "7kd0cbpz";

module.exports = {
  ci: {
    collect: {
      url: [`http://localhost:3000/r/${PUBLIC_SHARE_CODE}`],
      startServerCommand: "pnpm start",
      startServerReadyPattern: "Ready",
      startServerReadyTimeout: 60000,
      numberOfRuns: 3,
      settings: { chromeFlags: "--no-sandbox --headless=new" },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.95, aggregationMethod: "median" }],
        "categories:accessibility": ["error", { minScore: 0.95, aggregationMethod: "median" }],
        "categories:best-practices": ["error", { minScore: 0.95, aggregationMethod: "median" }],
        "largest-contentful-paint": ["error", { maxNumericValue: 2500, aggregationMethod: "median" }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.02, aggregationMethod: "median" }],
        "total-blocking-time": ["error", { maxNumericValue: 200, aggregationMethod: "median" }],
        redirects: ["error", { maxLength: 0 }],
      },
    },
    upload: { target: "filesystem", outputDir: "./lhci-report-share" },
  },
};
