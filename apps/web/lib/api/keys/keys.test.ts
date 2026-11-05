import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { KEY_FILES, norm, qk } from "./index";

type Factory = (...args: unknown[]) => readonly unknown[];
type Node = Factory | { [k: string]: Node };

/** Every factory under a namespace, with its dotted name. */
function factories(node: Node, path: string): [string, Factory][] {
  if (typeof node === "function") return [[path, node]];
  return Object.entries(node).flatMap(([k, v]) => factories(v, `${path}.${k}`));
}

const sample = (f: Factory) => f("x", "y", "z");

test("norm() drops empty values and sorts keys", () => {
  assert.deepEqual(norm({ theme: "fork", phase: undefined, q: "", src: null, page: 0, open: false }), {
    open: false,
    page: 0,
    theme: "fork",
  });
  assert.deepEqual(Object.keys(norm({ z: 1, a: 2, m: 3 })), ["a", "m", "z"]);
  assert.deepEqual(norm({ theme: "fork" }), norm({ phase: undefined, theme: "fork" }));
  assert.equal(JSON.stringify(norm({ b: 1, a: 1 })), JSON.stringify(norm({ a: 1, b: 1 })));
});

test("norm() never mutates its input", () => {
  const input = { b: "1", a: undefined };
  norm(input);
  assert.deepEqual(Object.keys(input), ["b", "a"]);
});

test("every factory's first segment is the domain it is declared under, in its own file", () => {
  for (const [file, fragment] of Object.entries(KEY_FILES)) {
    for (const [domain, node] of Object.entries(fragment as Record<string, Node>)) {
      for (const [name, f] of factories(node, domain)) {
        const key = sample(f);
        assert.ok(Array.isArray(key) && key.length > 0, `${file}.ts ${name}() returns a non-empty array`);
        assert.equal(key[0], domain, `${file}.ts ${name}() starts with "${domain}"`);
      }
    }
  }
});

test("each domain is declared in exactly one key file", () => {
  const seen = new Map<string, string>();
  for (const [file, fragment] of Object.entries(KEY_FILES)) {
    for (const domain of Object.keys(fragment)) {
      assert.ok(!seen.has(domain), `domain "${domain}" is declared in ${seen.get(domain)}.ts and ${file}.ts`);
      seen.set(domain, file);
    }
  }
  assert.deepEqual([...seen.keys()].sort(), Object.keys(qk).sort(), "qk spreads every file");
});

test("every key file in the directory is registered in KEY_FILES", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts" && f !== "norm.ts")
    .map((f) => f.slice(0, -3))
    .sort();
  assert.deepEqual(files, Object.keys(KEY_FILES).sort());
});

test("all() is a prefix of every sibling key (prefix invalidation relies on it)", () => {
  for (const [domain, node] of Object.entries(qk as unknown as Record<string, Node>)) {
    if (typeof node === "function" || typeof node.all !== "function") continue;
    const all = sample(node.all as Factory);
    for (const [name, f] of factories(node, domain)) {
      const key = sample(f);
      assert.deepEqual(key.slice(0, all.length), [...all], `${name}() starts with ${domain}.all()`);
    }
  }
});

test("factories are pure: the same input gives an equal key", () => {
  for (const [domain, node] of Object.entries(qk as unknown as Record<string, Node>)) {
    for (const [name, f] of factories(node, domain)) {
      assert.deepEqual(sample(f), sample(f), name);
    }
  }
});

test("P1 keys have their documented shapes", () => {
  assert.deepEqual(qk.me(), ["me"]);
  assert.deepEqual(qk.catalog.openingsIndex(), ["catalog", "openings", "index"]);
  assert.deepEqual(qk.billing.refresh(), ["billing", "refresh"]);
  assert.deepEqual(qk.catalog.openings("sic", undefined), ["catalog", "openings", { q: "sic" }]);
  assert.deepEqual(qk.games.list({ tc: "blitz", q: "" }), ["games", "list", { tc: "blitz" }]);
});
