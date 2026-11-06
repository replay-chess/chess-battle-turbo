// Lighthouse CI for the game screen (phase-02 plan 12.8 "Lighthouse CI (mobile)"; FIX-A: it was missing).
// Mobile emulation (Lighthouse's default), 3 runs, median: LCP ≤ 2.5 s, CLS ≤ 0.02, TBT ≤ 200 ms on the demo game
// in `your_move`. Run by nightly.yml (job `lighthouse`) against a local `next build && next start` with the test
// app env; locally: `pnpm build && npx @lhci/cli@0.14.0 autorun --config=lighthouserc.cjs` from apps/web.
/* global module */
module.exports = {
  ci: {
    collect: {
      url: ["http://localhost:3000/dev/ui/game?state=your_move&freeze=1"],
      startServerCommand: "pnpm start",
      startServerReadyPattern: "Ready",
      startServerReadyTimeout: 60000,
      numberOfRuns: 3,
      settings: { chromeFlags: "--no-sandbox --headless=new" },
    },
    assert: {
      assertions: {
        "largest-contentful-paint": ["error", { maxNumericValue: 2500, aggregationMethod: "median" }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.02, aggregationMethod: "median" }],
        "total-blocking-time": ["error", { maxNumericValue: 200, aggregationMethod: "median" }],
      },
    },
    upload: { target: "filesystem", outputDir: "./lhci-report" },
  },
};
