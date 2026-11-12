// Bundles the analysis worker (phase-03 plan task C1/C7): dist/main.cjs (the process), dist/bench.cjs (the
// `stockfish bench` + 60-ply sample of task C1, run inside the image), dist/smoke.cjs (the post-deploy smoke of
// §12.8, run by deploy-oci.yml inside the container) and dist/worker-flood.cjs (the §12.7 queue throughput and
// co-location gates). The workspace packages export TypeScript
// sources, so they are bundled; npm dependencies stay external (installed in the image, better-sqlite3 loads its
// N-API prebuild). The generated Prisma client is not bundled: `#generated` is rewritten to the relative path of
// packages/db/generated/prisma from dist/, which exists both in the repo and in the image (as in the socket build).
import { build } from "esbuild";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outdir = resolve(root, "dist");
const generated = resolve(root, "../../packages/db/generated/prisma/index.js");

/** @type {import("esbuild").Plugin} */
const externals = {
  name: "externals",
  setup(b) {
    b.onResolve({ filter: /^#generated$/ }, () => ({
      path: `./${relative(outdir, generated).split("\\").join("/")}`,
      external: true,
    }));
    b.onResolve({ filter: /^[^./#]/ }, (args) => {
      if (args.path.startsWith("@repo/")) return undefined;
      return { path: args.path, external: true };
    });
  },
};

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  legalComments: "none",
  plugins: [externals],
  logLevel: "info",
};

await build({ ...common, entryPoints: [resolve(root, "src/main.ts")], outfile: resolve(outdir, "main.cjs") });
await build({ ...common, entryPoints: [resolve(root, "scripts/bench.ts")], outfile: resolve(outdir, "bench.cjs") });
await build({ ...common, entryPoints: [resolve(root, "scripts/smoke.ts")], outfile: resolve(outdir, "smoke.cjs") });
// The §12.7 throughput and co-location gates, run inside the worker container on the dev VM (FIX-1).
await build({ ...common, entryPoints: [resolve(root, "scripts/worker-flood.ts")], outfile: resolve(outdir, "worker-flood.cjs") });
