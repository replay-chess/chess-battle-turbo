// Package wiring (phase-04 plan §2.1 item 2, P4-FOUNDATION): the manifest is ESM with the subpath exports the
// consumers rely on (`.`, `./*` → src), chess.js is pinned with the rest of the repo, the web app transpiles the
// package and the worker, the web and the seeds depend on it. Guards the skeleton WP-B builds on; it does not test
// the clients or the mappers.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Manifest = {
  name: string;
  type?: string;
  sideEffects?: boolean;
  exports?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const read = (rel: string): Manifest => JSON.parse(readFileSync(resolve(root, rel), "utf8")) as Manifest;
const pkg = read("package.json");

describe("@repo/chess-import package", () => {
  it("is an ESM package without side effects", () => {
    assert.equal(pkg.name, "@repo/chess-import");
    assert.equal(pkg.type, "module");
    assert.equal(pkg.sideEffects, false);
  });

  it("exports the barrel and the src subpaths", () => {
    assert.deepEqual(pkg.exports, { ".": "./src/index.ts", "./*": "./src/*.ts" });
  });

  it("pins chess.js and zod to the versions the rest of the repo uses", () => {
    const gameCore = read("../game-core/package.json");
    const contracts = read("../contracts/package.json");
    assert.equal(pkg.dependencies?.["chess.js"], gameCore.dependencies?.["chess.js"]);
    assert.equal(pkg.dependencies?.zod, contracts.devDependencies?.zod);
  });

  it("resolves through its own name", async () => {
    const mod: Record<string, unknown> = await import("@repo/chess-import");
    assert.equal(typeof mod, "object");
  });

  it("is in the web app's transpilePackages", () => {
    const nextConfig = readFileSync(resolve(root, "../../apps/web/next.config.js"), "utf8");
    const line = nextConfig.split("\n").find((l) => l.includes("transpilePackages"));
    assert.ok(line, "next.config.js has a transpilePackages line");
    assert.match(line, /"@repo\/chess-import"/);
  });

  it("is a dependency of the worker and the web, and a dev dependency of the seeds (@repo/db)", () => {
    assert.equal(read("../../apps/analysis-worker/package.json").dependencies?.["@repo/chess-import"], "workspace:*");
    assert.equal(read("../../apps/web/package.json").dependencies?.["@repo/chess-import"], "workspace:*");
    assert.equal(read("../db/package.json").devDependencies?.["@repo/chess-import"], "workspace:*");
  });
});
