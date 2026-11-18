// ESLint for the training library (phase-05 plan §3.3, §8): the shared base config plus the package's purity rules.
// The modules are shared by the web routes, the worker and (through the /grade, /labels and /items subpaths) the
// browser, so the sources never import Node built-ins, Prisma or the database package, and the browser subpaths never
// import ts-fsrs (bundle watch item, §9.5). Tests may use Node built-ins. `pnpm --filter @repo/chess-training lint`
// runs with --max-warnings 0.
//
// P6 (phase-06 plan §8, §13 WP1 acceptance): the weakness engine `src/weakness/**` and the baseline loader
// `baselines/**` are pure too — no Node built-ins, no Prisma, no database package, no DOM or React — and the weakness
// modules the browser imports (`labels`, `slug`, `progress`, `status`, `drill`, `constants`) never reach ts-fsrs or
// `session.ts` (`browser-subpaths.test.ts` walks their graph). `scripts/**` (the laptop-only baseline builders) and
// `test/**` may use Node.
import { config } from "@repo/eslint-config/base";

const SERVER_ONLY = [
  { group: ["node:*"], message: "@repo/chess-training is shared with the browser and the worker: no Node built-ins." },
  { group: ["@prisma/*", "@repo/db", "@repo/db/*"], message: "@repo/chess-training is pure: no database access." },
];

/** No DOM, no React in the weakness engine (it runs in the worker and the seed as well as the browser). */
const NO_DOM_IMPORTS = [{ group: ["react", "react/*", "react-dom", "react-dom/*", "next", "next/*"], message: "The weakness engine is UI-free." }];
const DOM_GLOBALS = ["window", "document", "navigator", "localStorage", "sessionStorage", "location", "fetch", "HTMLElement", "requestAnimationFrame"].map(
  (name) => ({ name, message: "The weakness engine is pure: no DOM or network globals (take inputs as arguments)." }),
);

export default [
  ...config,
  { ignores: ["node_modules/**"] },
  {
    files: ["src/**/*.ts", "baselines/**/*.ts"],
    ignores: ["src/**/*.test.ts", "baselines/**/*.test.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: SERVER_ONLY }] },
  },
  {
    files: ["src/weakness/**/*.ts", "baselines/**/*.ts"],
    ignores: ["src/**/*.test.ts", "baselines/**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [...SERVER_ONLY, ...NO_DOM_IMPORTS] }],
      "no-restricted-globals": ["error", ...DOM_GLOBALS],
    },
  },
  {
    // The subpaths the browser imports (plan §8 intro, §9.5): interval previews arrive precomputed in the payload.
    // `rating.ts` is the runner's puzzle-rating preview (D-13). `browser-subpaths.test.ts` checks the whole graph.
    files: [
      "src/grade.ts",
      "src/labels.ts",
      "src/items.ts",
      "src/rating.ts",
      "src/weakness/constants.ts",
      "src/weakness/labels.ts",
      "src/weakness/slug.ts",
      "src/weakness/progress.ts",
      "src/weakness/status.ts",
      "src/weakness/drill.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "ts-fsrs", message: "Browser subpaths never import ts-fsrs; use the precomputed previews." }],
          patterns: [...SERVER_ONLY, ...NO_DOM_IMPORTS, { group: ["./session", "../session"], message: "session.ts pulls ts-fsrs." }],
        },
      ],
    },
  },
];
