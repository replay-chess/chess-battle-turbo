// Package wiring (phase-05 plan §3.3, P5-FOUNDATION): the manifest is ESM with the subpath exports the consumers rely
// on (`.` for server code, `./*` → src for the browser subpaths, `./puzzles/*` for the committed shard manifest),
// ts-fsrs is pinned to the version the FSRS golden values were measured with (D-7), the web app transpiles the
// package, and the web, the worker and the seeds depend on it. Guards the skeleton WP-B builds on; it does not test
// the domain modules.
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

describe("@repo/chess-training package", () => {
  it("is an ESM package without side effects", () => {
    assert.equal(pkg.name, "@repo/chess-training");
    assert.equal(pkg.type, "module");
    assert.equal(pkg.sideEffects, false);
  });

  it("exports the server barrel, the src subpaths and the committed puzzle manifest folder", () => {
    assert.deepEqual(pkg.exports, { ".": "./src/index.ts", "./puzzles/*": "./puzzles/*", "./*": "./src/*.ts" });
  });

  it("pins ts-fsrs to 5.4.2 (D-7: Node 22 on Vercel and the worker; v6 needs Node 24)", () => {
    assert.equal(pkg.dependencies?.["ts-fsrs"], "5.4.2");
  });

  it("pins chess.js to the version the rest of the repo uses", () => {
    assert.equal(pkg.dependencies?.["chess.js"], read("../game-core/package.json").dependencies?.["chess.js"]);
  });

  it("never depends on the database or Prisma", () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(all)) {
      assert.ok(!name.startsWith("@prisma/") && name !== "@repo/db", `${name} is not allowed in a pure package`);
    }
  });

  it("resolves through its own name", async () => {
    const mod: Record<string, unknown> = await import("@repo/chess-training");
    assert.equal(typeof mod, "object");
  });

  it("is in the web app's transpilePackages", () => {
    const nextConfig = readFileSync(resolve(root, "../../apps/web/next.config.js"), "utf8");
    const line = nextConfig.split("\n").find((l) => l.includes("transpilePackages"));
    assert.ok(line, "next.config.js has a transpilePackages line");
    assert.match(line, /"@repo\/chess-training"/);
  });

  it("is a dependency of the web and the worker, and a dev dependency of the seeds (@repo/db)", () => {
    assert.equal(read("../../apps/web/package.json").dependencies?.["@repo/chess-training"], "workspace:*");
    assert.equal(read("../../apps/analysis-worker/package.json").dependencies?.["@repo/chess-training"], "workspace:*");
    assert.equal(read("../db/package.json").devDependencies?.["@repo/chess-training"], "workspace:*");
  });

  it("gives the worker its npm dependencies at the same versions (the worker bundle keeps npm packages external)", () => {
    const worker = read("../../apps/analysis-worker/package.json");
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      if (name.startsWith("@repo/")) continue;
      assert.equal(worker.dependencies?.[name], pkg.dependencies?.[name], `apps/analysis-worker needs ${name}`);
    }
  });

  it("is copied into both server images (the worker bundles it; the socket's frozen install needs its manifest)", () => {
    for (const app of ["analysis-worker", "web-socket"]) {
      const dockerfile = readFileSync(resolve(root, `../../apps/${app}/Dockerfile`), "utf8");
      assert.match(dockerfile, /COPY packages\/chess-training\/package\.json \.\/packages\/chess-training\//, app);
      assert.match(dockerfile, /COPY packages\/chess-training \.\/packages\/chess-training\n/, app);
    }
  });
});
