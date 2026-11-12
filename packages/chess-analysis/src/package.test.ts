// Package wiring (phase-03 plan task A1): the manifest is ESM with the subpath exports the consumers rely on
// (`.`, `./*` → src, `./fixtures/*` → fixtures), and the web app transpiles it. Guards the skeleton every other
// P3 package builds on; it does not test grading.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  name: string;
  type: string;
  sideEffects: boolean;
  exports: Record<string, string>;
  dependencies?: Record<string, string>;
};

describe("@repo/chess-analysis package", () => {
  it("is an ESM package without side effects", () => {
    assert.equal(pkg.name, "@repo/chess-analysis");
    assert.equal(pkg.type, "module");
    assert.equal(pkg.sideEffects, false);
  });

  it("exports the barrel, src subpaths and fixtures", () => {
    assert.deepEqual(pkg.exports, {
      ".": "./src/index.ts",
      "./fixtures/*": "./fixtures/*.ts",
      "./*": "./src/*.ts",
    });
  });

  it("pins chess.js to the version the rest of the repo replays with", () => {
    const gameCore = JSON.parse(readFileSync(resolve(root, "../game-core/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    assert.equal(pkg.dependencies?.["chess.js"], gameCore.dependencies["chess.js"]);
  });

  it("resolves through its own name", async () => {
    const mod: Record<string, unknown> = await import("@repo/chess-analysis");
    assert.equal(typeof mod, "object");
  });

  it("is in the web app's transpilePackages", () => {
    const nextConfig = readFileSync(resolve(root, "../../apps/web/next.config.js"), "utf8");
    const line = nextConfig.split("\n").find((l) => l.includes("transpilePackages"));
    assert.ok(line, "next.config.js has a transpilePackages line");
    assert.match(line, /"@repo\/chess-analysis"/);
  });
});
