import { nextJsConfig } from "@repo/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  {
    ignores: [
      "app/generated/**",
      ".next-*/**",
      "playwright-report*/**",
      "test-results/**",
      "public/sw.js",
      "public/workbox-*.js",
      "public/swe-worker-*.js",
      // Vendored minified Stockfish build, not our code.
      "public/workers/**",
    ],
  },
  {
    files: ["e2e/**", "playwright*.ts", "prisma/**", "next.config.js", "scripts/**"],
    rules: { "turbo/no-undeclared-env-vars": "off" },
  },
];
