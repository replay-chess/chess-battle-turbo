import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ALLOWED_GUARDS, GUARD_SOURCES, KILL_SWITCHES, TEST_HOOKS, prodGuardEnv, type RouteHook } from "./registry";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOOK_ROOTS = ["app/dev", "app/api/dev", "app/api/test"];

function listFiles(rel: string): string[] {
  const abs = path.join(WEB, rel);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(WEB, path.join(e.parentPath, e.name)).split(path.sep).join("/"));
}

/** URL of a page.tsx / route.ts file: route groups dropped, dynamic segments kept as `[x]`. */
export function urlOf(file: string): string | null {
  const m = /^app\/(.*?)\/?(page|route)\.(tsx?|jsx?)$/.exec(file);
  if (!m) return null;
  const segments = m[1]!.split("/").filter((s) => s && !/^\(.*\)$/.test(s));
  if (segments.some((s) => s.startsWith("_") || s.startsWith("@"))) return null; // private folders and slots
  return "/" + segments.join("/");
}

/** A registry path matches a URL template when every `[param]` segment accepts any value. */
export function pathMatchesTemplate(template: string, concrete: string): boolean {
  const t = template.split("/");
  const c = concrete.split("/");
  if (t.some((s) => s.startsWith("[..."))) {
    const fixed = t.findIndex((s) => s.startsWith("[..."));
    return c.length >= fixed + 1 && t.slice(0, fixed).every((s, i) => s.startsWith("[") || s === c[i]);
  }
  return t.length === c.length && t.every((s, i) => s.startsWith("[") || s === c[i]);
}

const routeHooks = TEST_HOOKS.filter((h): h is RouteHook => h.kind === "route");

describe("test-hook registry", () => {
  it("has unique ids", () => {
    const ids = TEST_HOOKS.map((h) => h.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("guards every hook with testHooksEnabled, isNonProdApp, devRoutesEnabled or isTestBuild", () => {
    for (const hook of TEST_HOOKS) assert.ok(ALLOWED_GUARDS.includes(hook.guard), `${hook.id}: ${hook.guard}`);
    assert.deepEqual([...ALLOWED_GUARDS].sort(), ["devRoutesEnabled", "isNonProdApp", "isTestBuild", "testHooksEnabled"]);
  });

  it("each guard name has exactly one definition, in its GUARD_SOURCES file", () => {
    const sources = ["lib", "app", "components"].flatMap(listFiles).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
    for (const [guard, file] of Object.entries(GUARD_SOURCES)) {
      const re = new RegExp(`export (async )?function ${guard}\\b`);
      const defs = sources.filter((f) => re.test(readFileSync(path.join(WEB, f), "utf8")));
      assert.deepEqual(defs, [file], `${guard} is defined in ${defs.join(", ") || "no file"}`);
    }
  });

  it("the telemetry sink checks its registered guard", () => {
    const src = readFileSync(path.join(WEB, "lib/analytics/shell-events.ts"), "utf8");
    const hook = TEST_HOOKS.find((h) => h.id === "telemetry-sink");
    assert.equal(hook?.guard, "isTestBuild");
    assert.match(src, /NEXT_PUBLIC_TELEMETRY_SINK !== "1" \|\| !isTestBuild\(\)/);
  });

  it("every guard is exported from its source file (skipped until that file lands)", (t) => {
    for (const [guard, file] of Object.entries(GUARD_SOURCES)) {
      const abs = path.join(WEB, file);
      if (!existsSync(abs)) {
        t.diagnostic(`${file} does not exist yet; ${guard} unchecked`);
        continue;
      }
      assert.match(readFileSync(abs, "utf8"), new RegExp(`export (async )?function ${guard}\\b`), `${guard} in ${file}`);
    }
  });

  it("covers every file under app/dev, app/api/dev and app/api/test with a route entry", () => {
    const uncovered = HOOK_ROOTS.flatMap(listFiles).filter(
      (file) => !routeHooks.some((h) => path.matchesGlob(file, h.files)),
    );
    assert.deepEqual(uncovered, [], `files without a registry entry: ${uncovered.join(", ")}`);
  });

  it("lists every dev page and route URL so prod-guard.spec.ts probes it", () => {
    const missing: string[] = [];
    for (const file of HOOK_ROOTS.flatMap(listFiles)) {
      const url = urlOf(file);
      if (!url) continue;
      const hook = routeHooks.find((h) => path.matchesGlob(file, h.files));
      if (!hook?.paths.some((p) => pathMatchesTemplate(url, p))) missing.push(`${url} (${file})`);
    }
    assert.deepEqual(missing, [], `add these URLs to the entry's paths: ${missing.join(", ")}`);
  });

  it("each route file under a hook calls the guard (directly or through an ancestor layout)", () => {
    for (const hook of routeHooks) {
      const files = HOOK_ROOTS.flatMap(listFiles).filter((f) => path.matchesGlob(f, hook.files));
      for (const file of files) {
        if (!/\/(page|route)\.(tsx?|jsx?)$/.test(file)) continue;
        const guarded = (f: string) => readFileSync(path.join(WEB, f), "utf8").includes(hook.guard);
        if (file.endsWith("route.ts") || file.endsWith("route.tsx")) {
          assert.ok(guarded(file), `${file} must call ${hook.guard}() itself (layouts do not wrap route handlers)`);
          continue;
        }
        const dirs = path.posix.dirname(file).split("/");
        const layouts = dirs
          .map((_, i) => `${dirs.slice(0, i + 1).join("/")}/layout.tsx`)
          .filter((l) => existsSync(path.join(WEB, l)));
        assert.ok(guarded(file) || layouts.some(guarded), `${file}: no ${hook.guard}() in the page or a layout above it`);
      }
    }
  });

  it("header and env hooks have a production proof", () => {
    for (const hook of TEST_HOOKS) {
      if (hook.kind === "header") {
        assert.ok(Object.keys(hook.headers).length > 0, hook.id);
        assert.match(hook.probe.path, /^\/api\//, hook.id);
      }
      if (hook.kind === "env" || hook.kind === "data") {
        if (hook.proof.by === "unit") assert.match(hook.proof.test, /\.test\.ts$/, hook.id);
      }
    }
  });

  it("starts prod-guard with production + ALLOW_TEST_HOOKS=1 and every env hook set", () => {
    const env = prodGuardEnv();
    assert.equal(env.NEXT_PUBLIC_APP_ENV, "production");
    assert.equal(env.ALLOW_TEST_HOOKS, "1");
    for (const hook of TEST_HOOKS) if (hook.kind === "env") assert.ok(env[hook.env], hook.env);
  });

  it("keeps kill switches out of the hook list", () => {
    const envHooks = new Set(TEST_HOOKS.flatMap((h) => (h.kind === "env" ? [h.env] : [])));
    for (const k of KILL_SWITCHES) assert.ok(!envHooks.has(k.env), k.env);
  });

  it("urlOf and pathMatchesTemplate handle groups, private folders and params", () => {
    assert.equal(urlOf("app/dev/ui/page.tsx"), "/dev/ui");
    assert.equal(urlOf("app/(app)/play/page.tsx"), "/play");
    assert.equal(urlOf("app/dev/ui/_sections/shell.tsx"), null);
    assert.equal(urlOf("app/api/dev/e2e/[slug]/route.ts"), "/api/dev/e2e/[slug]");
    assert.ok(pathMatchesTemplate("/api/dev/e2e/[slug]", "/api/dev/e2e/weakness"));
    assert.ok(!pathMatchesTemplate("/dev/ui", "/dev/ui/shell"));
  });
});
