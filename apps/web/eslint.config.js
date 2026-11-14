import { nextJsConfig } from "@repo/eslint-config/next-js";

// ── Data-layer guardrails (phase-01 plan 5.4, 13.3 1B·J; CDL D15) ─────────────────────────────────────────────
// ESLint replaces (does not merge) a rule's options when two config objects set it for the same file, so every
// `no-restricted-syntax` block below spreads all the selector groups that apply to its files.

/** Directories created for the new data layer. Legacy files elsewhere are exempt until their phase converts them. */
const NEW_DATA_DIRS = [
  "components/data/**",
  "components/system/**",
  "lib/api/queries/**",
  "lib/api/mutations/**",
  "app/dev/ui/data/**",
];

/**
 * api() response schemas are parsed in dev and test builds only (lib/api/schema.ts). Allowed forms:
 * `schema: devSchema(X)` (dev-only pages and tests), `schema: process.env.NODE_ENV === "production" ? undefined : X`
 * (client code: only this form keeps zod out of production chunks), or the shorthand `{ schema }` for a variable
 * declared in one of those forms.
 */
const API_SCHEMA = [
  {
    selector:
      "CallExpression[callee.name='api'] > ObjectExpression > Property[key.name='schema'][shorthand=false]:not([value.callee.name='devSchema']):not([value.type='ConditionalExpression'][value.consequent.name='undefined'])",
    message:
      'Pass api() schemas as `process.env.NODE_ENV === "production" ? undefined : Schema` (client code) or devSchema(Schema) (dev pages), never directly (lib/api/schema.ts).',
  },
  {
    selector: "VariableDeclarator[id.name='schema'][init.type=/^(Identifier|MemberExpression)$/]",
    message:
      'A `schema` variable for api() must be `process.env.NODE_ENV === "production" ? undefined : Schema` (lib/api/schema.ts).',
  },
];

/**
 * No raw fetch of our API in the new directories: go through api() (lib/api/client.ts). esquery ends a regex at the
 * first "/", so the slash is spelled \x2F.
 */
const NO_FETCH_API = [
  {
    selector: "CallExpression[callee.name='fetch'][arguments.0.value=/^\\x2Fapi(\\x2F|$)/]",
    message: 'Use api() from "@/lib/api/client" instead of fetch("/api…") (CDL D15).',
  },
  {
    selector: "CallExpression[callee.name='fetch'][arguments.0.quasis.0.value.raw=/^\\x2Fapi(\\x2F|$)/]",
    message: 'Use api() from "@/lib/api/client" instead of fetch(`/api…`) (CDL D15).',
  },
  {
    selector: "CallExpression[callee.property.name='fetch'][arguments.0.value=/^\\x2Fapi(\\x2F|$)/]",
    message: 'Use api() from "@/lib/api/client" instead of fetch("/api…") (CDL D15).',
  },
];

/**
 * Services take `now` from the caller (ctx.now / requestNow(), x-rc-now aware; plan 7.2, X5). New code in
 * lib/services and lib/data never reads the wall clock itself. `new Date(value)` is fine.
 */
const NO_WALL_CLOCK = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: "Take `now` from the caller (ctx.now / requestNow()) instead of new Date() (plan 7.2).",
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: "Take `now` from the caller (ctx.now / requestNow()) instead of Date.now() (plan 7.2).",
  },
];

/** Phase 0 service files that read the clock today. Remove an entry when its phase passes `now` in. */
const WALL_CLOCK_ALLOW_LIST = [
  "lib/services/tournament/tournament.service.ts",
  "lib/services/matchmaking/matchmaking.service.ts",
];

const TESTS = ["**/*.test.ts", "**/*.test.tsx"];

// ── P5 (phase-05 plan §5.1, §9.5, §8 intro; WP-F) ─────────────────────────────────────────────────────────────

/** The P5 client paths: the trainer, the hub, the bank, Home. */
const P5_CLIENT_DIRS = ["app/(app)/train/**", "app/(app)/home/**", "components/train/**", "components/home/**", "features/train/**"];

/**
 * No legacy board, no browser engine, no ts-fsrs and no @repo/chess-training barrel on P5 routes: interval previews
 * arrive precomputed, solutions are stored, and the browser imports only the `/grade`, `/labels`, `/items`, `/day`
 * subpaths (the budget check also asserts "ts-fsrs" is absent from the P5 chunks).
 */
const P5_RESTRICTED_IMPORTS = {
  paths: [
    { name: "ts-fsrs", message: "No ts-fsrs in the browser: use the payload's precomputed previews (phase-05 plan §5.4)." },
    { name: "@repo/chess-training", message: "Import a subpath (@repo/chess-training/grade, /labels, /items, /day), never the server barrel." },
    { name: "@/app/components/ChessBoard", message: "P5 uses the P2 board (@/components/board)." },
    { name: "@/lib/hooks/useStockfish", message: "No browser engine on P5 routes: solutions are precomputed (§9.5)." },
  ],
  patterns: [
    { group: ["**/app/components/ChessBoard", "**/hooks/useStockfish"], message: "No legacy board or browser engine on P5 routes (§9.5)." },
    { group: ["@repo/chess-training/fsrs", "@repo/chess-training/session", "@repo/chess-training/plan"], message: "Server-only training modules (ts-fsrs inside)." },
  ],
};

/**
 * `rc/no-prefetch-session-create` (§5.1): a link to a page that creates a session (`/train/bank/session?plan|card|
 * cards|game|theme…`, `/train/puzzles?theme|n|pick…`) must say `prefetch={false}`: a router prefetch must never create
 * a session. Only the resume form `?s=<ref>` may be prefetched. esquery ends a regex at "/", hence \x2F.
 */
const NO_PREFETCH_SESSION_CREATE = [
  {
    selector:
      "JSXOpeningElement[name.name='Link']:has(JSXAttribute[name.name='href'][value.value=/^\\x2Ftrain\\x2F(bank\\x2Fsession|puzzles)(?!\\?s=)/]):not(:has(JSXAttribute[name.name='prefetch'][value.expression.value=false]))",
    message: "rc/no-prefetch-session-create: links that create a training session need prefetch={false} (phase-05 plan §5.1).",
  },
  {
    selector:
      "JSXOpeningElement[name.name='Link']:has(JSXAttribute[name.name='href'] > JSXExpressionContainer > TemplateLiteral[quasis.0.value.raw=/^\\x2Ftrain\\x2F(bank\\x2Fsession|puzzles)(?!\\?s=)/]):not(:has(JSXAttribute[name.name='prefetch'][value.expression.value=false]))",
    message: "rc/no-prefetch-session-create: links that create a training session need prefetch={false} (phase-05 plan §5.1).",
  },
];

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
    files: ["e2e/**", "playwright*.ts", "prisma/**", "next.config.js", "scripts/**", "config/**"],
    rules: { "turbo/no-undeclared-env-vars": "off" },
  },
  // api() schemas everywhere in app code.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: TESTS,
    rules: { "no-restricted-syntax": ["warn", ...API_SCHEMA] },
  },
  // P5: session-creating links are never prefetched (app and components already carry API_SCHEMA; features gets the rule alone).
  {
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    ignores: TESTS,
    rules: { "no-restricted-syntax": ["warn", ...API_SCHEMA, ...NO_PREFETCH_SESSION_CREATE] },
  },
  {
    files: ["features/**/*.tsx"],
    ignores: TESTS,
    rules: { "no-restricted-syntax": ["warn", ...NO_PREFETCH_SESSION_CREATE] },
  },
  // P5 client paths: no legacy board, no browser engine, no ts-fsrs, no training barrel.
  {
    files: P5_CLIENT_DIRS,
    rules: { "no-restricted-imports": ["error", P5_RESTRICTED_IMPORTS] },
  },
  // The new data-layer directories: api() only, no localStorage, no socket.io-client.
  {
    files: NEW_DATA_DIRS,
    ignores: TESTS,
    rules: {
      "no-restricted-syntax": ["warn", ...API_SCHEMA, ...NO_FETCH_API],
      "no-restricted-globals": [
        "warn",
        { name: "localStorage", message: "Persisted client state goes through lib/storage (CDL D15)." },
      ],
      "no-restricted-properties": [
        "warn",
        { object: "window", property: "localStorage", message: "Persisted client state goes through lib/storage (CDL D15)." },
        { object: "globalThis", property: "localStorage", message: "Persisted client state goes through lib/storage (CDL D15)." },
      ],
      "no-restricted-imports": [
        "warn",
        {
          paths: [{ name: "socket.io-client", message: "Realtime goes through lib/realtime (CDL D15)." }],
          patterns: [{ group: ["socket.io-client/*"], message: "Realtime goes through lib/realtime (CDL D15)." }],
        },
      ],
    },
  },
  // Services and the data access layer: no wall clock in new code.
  {
    // P5 adds the train and home services (phase-05 plan §0 "Server clock", §12.1 clock.test.ts).
    files: ["lib/services/**/*.ts", "lib/data/**/*.ts", "lib/train/**/*.ts", "lib/home/**/*.ts", "lib/reports/**/*.ts"],
    ignores: [...TESTS, ...WALL_CLOCK_ALLOW_LIST],
    rules: { "no-restricted-syntax": ["warn", ...API_SCHEMA, ...NO_WALL_CLOCK] },
  },
];
