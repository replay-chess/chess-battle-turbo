// ESLint for the training library (phase-05 plan §3.3, §8): the shared base config plus the package's purity rules.
// The modules are shared by the web routes, the worker and (through the /grade, /labels and /items subpaths) the
// browser, so the sources never import Node built-ins, Prisma or the database package, and the browser subpaths never
// import ts-fsrs (bundle watch item, §9.5). Tests may use Node built-ins. `pnpm --filter @repo/chess-training lint`
// runs with --max-warnings 0.
import { config } from "@repo/eslint-config/base";

const SERVER_ONLY = [
  { group: ["node:*"], message: "@repo/chess-training is shared with the browser and the worker: no Node built-ins." },
  { group: ["@prisma/*", "@repo/db", "@repo/db/*"], message: "@repo/chess-training is pure: no database access." },
];

export default [
  ...config,
  { ignores: ["node_modules/**"] },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: SERVER_ONLY }] },
  },
  {
    // The subpaths the browser imports (plan §8 intro, §9.5): interval previews arrive precomputed in the payload.
    // `rating.ts` is the runner's puzzle-rating preview (D-13). `browser-subpaths.test.ts` checks the whole graph.
    files: ["src/grade.ts", "src/labels.ts", "src/items.ts", "src/rating.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "ts-fsrs", message: "Browser subpaths never import ts-fsrs; use the precomputed previews." }],
          patterns: SERVER_ONLY,
        },
      ],
    },
  },
];
