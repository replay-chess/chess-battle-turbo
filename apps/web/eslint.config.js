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
    files: ["lib/services/**/*.ts", "lib/data/**/*.ts"],
    ignores: [...TESTS, ...WALL_CLOCK_ALLOW_LIST],
    rules: { "no-restricted-syntax": ["warn", ...API_SCHEMA, ...NO_WALL_CLOCK] },
  },
];
