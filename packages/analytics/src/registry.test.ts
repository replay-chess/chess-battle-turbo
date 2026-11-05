import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { EVENTS, FORBIDDEN_PROPERTY_NAMES, declaredProperties, findPii, isEventName, parseEvent } from "./index";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/web");
const SCAN_DIRS = ["app", "lib", "components", "features"];
const SKIP_DIRS = new Set(["node_modules", "generated", ".next"]);

/**
 * Literal event names passed to a track helper, in both call shapes:
 *   trackSystem("rate_limited_shown", { ... })        positional
 *   trackShell({ name: "shell_nav_click", ... })      object with `name` (SPEC §3.10 helper)
 */
const CALL = /\b(trackShell|trackSystem|track)\(\s*(?:(["'`])([^"'`]+)\2|\{\s*name:\s*(["'`])([^"'`]+)\4)/g;
/** The same helpers called with neither form (a variable or computed name). */
const DYNAMIC_CALL = /\b(trackShell|trackSystem|track)\(\s*(?!["'`)]|\{\s*name:\s*["'`])/g;
/** `track` is checked only where it is the registry-typed helper, imported from an analytics module. */
const IMPORTS_TRACK = /import\s*\{[^}]*\btrack\b[^}]*\}\s*from\s*["'][^"']*analytics[^"']*["']/;

async function* sourceFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".next")) continue;
      yield* sourceFiles(path.join(dir, entry.name));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      yield path.join(dir, entry.name);
    }
  }
}

/** Every literal event name passed to a track helper in the web app. */
export async function scanTrackCalls(root = WEB) {
  const calls: Array<{ file: string; helper: string; event: string }> = [];
  const dynamic: Array<{ file: string; helper: string }> = [];
  for (const dir of SCAN_DIRS) {
    for await (const file of sourceFiles(path.join(root, dir))) {
      const src = await readFile(file, "utf8");
      const rel = path.relative(root, file);
      const checksTrack = IMPORTS_TRACK.test(src);
      for (const m of src.matchAll(CALL)) {
        if (m[1] === "track" && !checksTrack) continue; // a local closure named `track`
        calls.push({ file: rel, helper: m[1]!, event: (m[3] ?? m[5])! });
      }
      for (const m of src.matchAll(DYNAMIC_CALL)) {
        if (m[1] === "track" && !checksTrack) continue;
        // Skip the helper's own definition: `export function trackShell(`.
        const before = src.slice(Math.max(0, (m.index ?? 0) - 9), m.index);
        if (!/function\s*$/.test(before)) dynamic.push({ file: rel, helper: m[1]! });
      }
    }
  }
  return { calls, dynamic };
}

describe("event registry", () => {
  it("has unique event names in snake_case", () => {
    for (const name of Object.keys(EVENTS)) assert.match(name, /^[a-z][a-z0-9_]*$/);
  });

  it("declares no property named email, q, query, fen, pgn or name", () => {
    for (const name of Object.keys(EVENTS)) {
      if (!isEventName(name)) continue;
      for (const key of declaredProperties(name)) {
        assert.ok(!(FORBIDDEN_PROPERTY_NAMES as readonly string[]).includes(key.toLowerCase()), `${name}.${key}`);
      }
    }
  });

  it("parseEvent strips $ properties and super properties, then checks strictly", () => {
    assert.deepEqual(
      parseEvent("shell_palette_opened", { via: "button", app_env: "test", $lib: "web", $current_url: "/x" }),
      { ok: true },
    );
    assert.equal(parseEvent("shell_palette_opened", { via: "button", query: "morphy" }).ok, false);
    assert.equal(parseEvent("shell_palette_opened", { via: "button", app_env: "staging" }).ok, false);
    assert.equal(parseEvent("not_registered", {}).ok, false);
  });

  it("the web app calls track helpers only with registered events (static scan)", async () => {
    const { calls, dynamic } = await scanTrackCalls();
    const unregistered = calls.filter((c) => !isEventName(c.event));
    assert.deepEqual(unregistered, [], `unregistered events: ${JSON.stringify(unregistered)}`);
    const wrongHelper = calls.filter(
      (c) =>
        (c.helper === "trackShell" && !c.event.startsWith("shell_")) ||
        (c.helper === "trackSystem" && c.event.startsWith("shell_")),
    );
    assert.deepEqual(wrongHelper, [], `events sent through the wrong helper: ${JSON.stringify(wrongHelper)}`);
    // A non-literal event name cannot be checked here; the helper's parameter type
    // (EventName) still constrains it at compile time.
    if (dynamic.length) console.warn(`[analytics] ${dynamic.length} track call(s) with a non-literal event name`);
  });
});

describe("findPii", () => {
  it("flags emails, FEN boards, PGN move runs and forbidden texts", () => {
    const kinds = (v: unknown, f: string[] = []) => findPii(v, f).map((x) => x.kind);
    assert.deepEqual(kinds({ a: "rohit@example.com" }), ["email"]);
    assert.deepEqual(kinds({ a: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1" }), ["fen"]);
    assert.deepEqual(kinds({ a: "1. e4 e5 2. Nf3" }), ["pgn"]);
    assert.deepEqual(kinds({ a: "12...Nf6" }), ["pgn"]);
    assert.deepEqual(kinds({ a: "3.Bxf7+" }), ["pgn"]);
    assert.deepEqual(kinds({ a: "9. O-O" }), ["pgn"]);
    assert.deepEqual(kinds({ a: "23. exd8=Q#" }), ["pgn"]);
    // Version strings and dotted numbers are not moves (posthog-node sends $lib_version "5.56.4").
    assert.deepEqual(kinds({ $lib_version: "5.56.4", b: "1.2.3", c: "2026.11.05", d: "v1.58.2" }), []);
    assert.deepEqual(kinds({ nested: ["Paul Morphy"] }, ["morphy"]), ["forbidden"]);
  });

  it("passes registry-shaped values", () => {
    assert.deepEqual(findPii({ dest: "legends", surface: "sidebar", queryLength: 6, id: "goto:play" }), []);
    assert.deepEqual(findPii({ route_template: "/game/[gameId]", status: 500 }), []);
  });
});
