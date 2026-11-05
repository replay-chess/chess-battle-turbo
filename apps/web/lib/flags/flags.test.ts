import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import {
  POSTHOG_FLAGS_TIMEOUT_MS,
  evaluateFlags,
  isIgnoredOverrideEnv,
  parseFlagsOverride,
  type FlagDeps,
  type FlagViewer,
  type PostHogFlagEvaluator,
} from "./index";
import { FLAGS, FLAG_KEYS, FLAG_REGISTRIES, defaultFlags, flagEnv, flagFromMe } from "./registry";

const WEB = join(import.meta.dirname, "..", "..");

const member: FlagViewer = { user: { ref: "usr_abc", role: "user" }, entitlement: { member: true } };

function deps(overrides: Partial<FlagDeps> = {}): FlagDeps {
  return {
    appEnv: "dev",
    nodeEnv: "production",
    override: undefined,
    testHooksEnabled: () => true,
    posthog: null,
    timeoutMs: POSTHOG_FLAGS_TIMEOUT_MS,
    reportIgnoredOverride: () => {},
    ...overrides,
  };
}

const posthogSays =
  (values: Record<string, boolean | string | undefined>): PostHogFlagEvaluator =>
  async () =>
    values;

// ── registry ─────────────────────────────────────────────────────────────────────────────────────

test("registry: no key is declared in two phase files, and FLAGS is exactly their union", () => {
  const seen = new Map<string, string>();
  for (const [phase, registry] of Object.entries(FLAG_REGISTRIES)) {
    for (const key of Object.keys(registry)) {
      assert.equal(seen.has(key), false, `flag "${key}" is declared in both ${seen.get(key)} and ${phase}`);
      seen.set(key, phase);
    }
  }
  assert.deepEqual([...seen.keys()].sort(), Object.keys(FLAGS).sort());
  assert.deepEqual([...FLAG_KEYS].sort(), Object.keys(FLAGS).sort());
});

test("registry: every flag is kebab case with a boolean default for all four envs", () => {
  for (const [key, def] of Object.entries(FLAGS)) {
    assert.match(key, /^[a-z0-9]+(-[a-z0-9]+)*$/, key);
    for (const env of ["dev", "test", "production", "local"] as const) {
      assert.equal(typeof def.default[env], "boolean", `${key}.default.${env}`);
    }
  }
});

test("registry: shell-v3 is on in dev, test and local, off in production", () => {
  assert.deepEqual(FLAGS["shell-v3"].default, { dev: true, test: true, production: false, local: true });
});

test("flagEnv maps NEXT_PUBLIC_APP_ENV and fails closed", () => {
  assert.equal(flagEnv("dev", "production"), "dev");
  assert.equal(flagEnv("test", "production"), "test");
  assert.equal(flagEnv("production", "development"), "production");
  assert.equal(flagEnv(undefined, "development"), "local");
  assert.equal(flagEnv("", undefined), "local");
  assert.equal(flagEnv(undefined, "production"), "production");
  assert.equal(flagEnv("staging", "development"), "production");
});

test("flagFromMe reads MeData.flags and falls back to the registry default", () => {
  assert.equal(flagFromMe({ flags: { "shell-v3": false } }, "shell-v3", "dev"), false);
  assert.equal(flagFromMe({ flags: { "shell-v3": true } }, "shell-v3", "production"), true);
  assert.equal(flagFromMe(undefined, "shell-v3", "dev"), true);
  assert.equal(flagFromMe(null, "shell-v3", "production"), false);
  assert.equal(flagFromMe({ flags: {} }, "shell-v3", "production"), false);
  assert.equal(flagFromMe({}, "shell-v3", "dev"), true);
});

// ── FLAGS_OVERRIDE parsing ─────────────────────────────────────────────────────────────────────────

test("parseFlagsOverride: on/off spellings, whitespace, unknown keys and junk ignored", () => {
  assert.deepEqual(parseFlagsOverride("shell-v3:on"), { "shell-v3": true });
  assert.deepEqual(parseFlagsOverride(" shell-v3 : OFF "), { "shell-v3": false });
  assert.deepEqual(parseFlagsOverride("shell-v3:true"), { "shell-v3": true });
  assert.deepEqual(parseFlagsOverride("shell-v3:0"), { "shell-v3": false });
  assert.deepEqual(parseFlagsOverride("no-such-flag:on,shell-v3:off"), { "shell-v3": false });
  assert.deepEqual(parseFlagsOverride("no-such-flag:on"), {});
  assert.deepEqual(parseFlagsOverride("shell-v3"), {});
  assert.deepEqual(parseFlagsOverride("shell-v3:maybe"), {});
  assert.deepEqual(parseFlagsOverride(":on,,"), {});
  assert.deepEqual(parseFlagsOverride(undefined), {});
  assert.deepEqual(parseFlagsOverride(""), {});
});

// ── precedence ───────────────────────────────────────────────────────────────────────────────────

test("precedence: default when there is no override and no PostHog", async () => {
  assert.deepEqual(await evaluateFlags(member, deps({ appEnv: "dev" })), defaultFlags("dev"));
  assert.deepEqual(await evaluateFlags(member, deps({ appEnv: "production" })), { "shell-v3": false });
});

test("precedence: PostHog beats the default", async () => {
  const off = await evaluateFlags(member, deps({ appEnv: "dev", posthog: posthogSays({ "shell-v3": false }) }));
  assert.equal(off["shell-v3"], false);
  const on = await evaluateFlags(member, deps({ appEnv: "production", posthog: posthogSays({ "shell-v3": true }) }));
  assert.equal(on["shell-v3"], true);
  const variant = await evaluateFlags(member, deps({ appEnv: "production", posthog: posthogSays({ "shell-v3": "b" }) }));
  assert.equal(variant["shell-v3"], true, "a multivariate answer means on");
});

test("precedence: PostHog with no answer for a key (definitions not loaded) → default", async () => {
  const flags = await evaluateFlags(member, deps({ appEnv: "dev", posthog: posthogSays({}) }));
  assert.equal(flags["shell-v3"], true);
});

test("precedence: FLAGS_OVERRIDE beats PostHog when test hooks are on (acceptance: shell-v3 on in dev)", async () => {
  let called = false;
  const flags = await evaluateFlags(
    member,
    deps({
      appEnv: "dev",
      override: "shell-v3:on",
      posthog: async () => {
        called = true;
        return { "shell-v3": false };
      },
    }),
  );
  assert.equal(flags["shell-v3"], true);
  assert.equal(called, false, "PostHog is skipped when the override covers every key");

  const off = await evaluateFlags(member, deps({ appEnv: "test", override: "shell-v3:off" }));
  assert.equal(off["shell-v3"], false, "the flags-off project's server");
});

test("override is ignored when test hooks are off, and reported only on production", async () => {
  const reported: string[] = [];
  const report = (raw: string) => reported.push(raw);

  const prod = await evaluateFlags(
    member,
    deps({ appEnv: "production", override: "shell-v3:on", testHooksEnabled: () => false, reportIgnoredOverride: report }),
  );
  assert.equal(prod["shell-v3"], false);
  assert.deepEqual(reported, ["shell-v3:on"]);

  const devNoHooks = await evaluateFlags(
    member,
    deps({
      appEnv: "dev",
      override: "shell-v3:off",
      testHooksEnabled: () => false,
      posthog: posthogSays({ "shell-v3": true }),
      reportIgnoredOverride: report,
    }),
  );
  assert.equal(devNoHooks["shell-v3"], true, "falls through to PostHog");
  assert.equal(reported.length, 1, "dev without ALLOW_TEST_HOOKS is not a production misconfiguration");
});

test("startup report: FLAGS_OVERRIDE is flagged only where it is ignored on a production flag env", () => {
  assert.equal(isIgnoredOverrideEnv({ FLAGS_OVERRIDE: "shell-v3:on", NEXT_PUBLIC_APP_ENV: "production" }), true);
  assert.equal(isIgnoredOverrideEnv({ FLAGS_OVERRIDE: "shell-v3:on", NODE_ENV: "production" }), true, "unset app env on a prod build");
  assert.equal(
    isIgnoredOverrideEnv({ FLAGS_OVERRIDE: "shell-v3:on", NEXT_PUBLIC_APP_ENV: "production", ALLOW_TEST_HOOKS: "1" }),
    true,
    "ALLOW_TEST_HOOKS alone never enables hooks on production",
  );
  assert.equal(isIgnoredOverrideEnv({ NEXT_PUBLIC_APP_ENV: "production" }), false, "not set");
  assert.equal(isIgnoredOverrideEnv({ FLAGS_OVERRIDE: "shell-v3:on", NEXT_PUBLIC_APP_ENV: "dev", ALLOW_TEST_HOOKS: "1" }), false);
  assert.equal(isIgnoredOverrideEnv({ FLAGS_OVERRIDE: "shell-v3:on", NEXT_PUBLIC_APP_ENV: "dev" }), false, "dev without hooks is not production");
});

test("the ignored-override report raises a Sentry issue (logger.error with an Error), not only a log line", () => {
  const src = readFileSync(join(WEB, "lib", "flags", "index.ts"), "utf8");
  assert.match(src, /logger\.error\(err\.message, err\)/);
});

test("unknown key in the override is ignored; known keys still apply", async () => {
  const flags = await evaluateFlags(member, deps({ appEnv: "production", override: "nope:on,shell-v3:on" }));
  assert.deepEqual(flags, { "shell-v3": true });
  assert.deepEqual(Object.keys(flags), FLAG_KEYS);
});

// ── PostHog failure modes ────────────────────────────────────────────────────────────────────────

test("PostHog timeout → defaults, within the cap", async () => {
  const never: PostHogFlagEvaluator = () => new Promise(() => {});
  const started = performance.now();
  const flags = await evaluateFlags(member, deps({ appEnv: "production", posthog: never, timeoutMs: 40 }));
  const elapsed = performance.now() - started;
  assert.deepEqual(flags, defaultFlags("production"));
  assert.ok(elapsed < 40 + 200, `took ${elapsed} ms`);
});

test("the production cap is 300 ms", () => {
  assert.equal(POSTHOG_FLAGS_TIMEOUT_MS, 300);
});

test("PostHog error → defaults", async () => {
  const boom: PostHogFlagEvaluator = async () => {
    throw new Error("unreachable");
  };
  assert.deepEqual(await evaluateFlags(member, deps({ appEnv: "dev", posthog: boom })), defaultFlags("dev"));
  const syncBoom: PostHogFlagEvaluator = () => {
    throw new Error("sync");
  };
  assert.deepEqual(await evaluateFlags(member, deps({ appEnv: "dev", posthog: syncBoom })), defaultFlags("dev"));
});

test("PostHog gets the viewer ref (or anon) and app_env, role, member", async () => {
  const calls: Array<{ id: string; props: Record<string, string | boolean>; keys: string[] }> = [];
  const spy: PostHogFlagEvaluator = async (id, props, keys) => {
    calls.push({ id, props, keys });
    return {};
  };
  await evaluateFlags(member, deps({ appEnv: "dev", posthog: spy }));
  await evaluateFlags(null, deps({ appEnv: "production", posthog: spy }));
  await evaluateFlags(
    { user: { ref: "usr_admin", role: "admin" }, entitlement: { member: false } },
    deps({ appEnv: "test", posthog: spy }),
  );
  assert.deepEqual(calls, [
    { id: "usr_abc", props: { app_env: "dev", role: "user", member: true }, keys: FLAG_KEYS },
    { id: "anon", props: { app_env: "production", role: "anon", member: false }, keys: FLAG_KEYS },
    { id: "usr_admin", props: { app_env: "test", role: "admin", member: false }, keys: FLAG_KEYS },
  ]);
});

// ── never from middleware or the browser ─────────────────────────────────────────────────────────

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

const SERVER_FLAGS_IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](?:@\/lib\/flags(?:\/index)?|(?:\.\.?\/)+(?:lib\/)?flags(?:\/index)?)["']/;

test("middleware never imports the server flag module or posthog-node", () => {
  for (const file of ["middleware.ts", "middleware.js"]) {
    let src: string;
    try {
      src = readFileSync(join(WEB, file), "utf8");
    } catch {
      continue;
    }
    assert.doesNotMatch(src, SERVER_FLAGS_IMPORT, `${file} imports @/lib/flags`);
    assert.doesNotMatch(src, /["']posthog-node["']/, `${file} imports posthog-node`);
  }
});

test("no client module imports the server flag module or posthog-node", () => {
  const offenders: string[] = [];
  for (const root of ["app", "components", "lib", "features"]) {
    for (const file of sourceFiles(join(WEB, root))) {
      const src = readFileSync(file, "utf8");
      if (!/^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(src)) continue;
      if (SERVER_FLAGS_IMPORT.test(src) || /["']posthog-node["']/.test(src)) offenders.push(relative(WEB, file));
    }
  }
  assert.deepEqual(offenders, []);
});

test("lib/flags/client.ts reads the viewer payload only (no PostHog, no server module)", () => {
  const src = readFileSync(join(WEB, "lib/flags/client.ts"), "utf8");
  assert.doesNotMatch(src, /from\s+["']posthog-(?:node|js)["']/);
  assert.doesNotMatch(src, /from\s+["']\.\/index["']/);
  assert.doesNotMatch(src, /from\s+["']@\/lib\/flags["']/);
  assert.match(src, /qk\.me\(\)/);
});
