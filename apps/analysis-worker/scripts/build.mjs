// Bundles the analysis worker (phase-03 plan task C1/C7): dist/main.cjs (the process), dist/bench.cjs (the
// `stockfish bench` + 60-ply sample of task C1, run inside the image), dist/smoke.cjs (the post-deploy smoke of
// §12.8, run by deploy-oci.yml inside the container) and dist/worker-flood.cjs (the §12.7 queue throughput and
// co-location gates). The workspace packages export TypeScript
// sources, so they are bundled; npm dependencies stay external (installed in the image, better-sqlite3 loads its
// N-API prebuild). The generated Prisma client is not bundled: `#generated` is rewritten to the relative path of
// packages/db/generated/prisma from dist/, which exists both in the repo and in the image (as in the socket build).
import { build } from "esbuild";
import { dirname, relative, resolve } from "node:path";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
// `--outdir <dir inside this package>`: scripts/build.test.ts builds there and boots the bundle.
const outArg = argv.indexOf("--outdir");
const outdir = resolve(root, outArg >= 0 && argv[outArg + 1] ? argv[outArg + 1] : "dist");
const generated = resolve(root, "../../packages/db/generated/prisma/index.js");

/**
 * npm packages bundled instead of left external. sqids 0.3.0 (P5, through @repo/chess-training/items) ships a CommonJS
 * build that sets `exports.default` without the ES-module marker, so a CJS bundle's `import Sqids from "sqids"` would
 * receive the module object and crash at boot ("default is not a constructor"); bundled, esbuild reads its ESM build.
 */
const BUNDLED = new Set(["sqids"]);

/** @type {import("esbuild").Plugin} */
const externals = {
  name: "externals",
  setup(b) {
    b.onResolve({ filter: /^#generated$/ }, () => ({
      path: `./${relative(outdir, generated).split("\\").join("/")}`,
      external: true,
    }));
    b.onResolve({ filter: /^[^./#]/ }, (args) => {
      if (args.path.startsWith("@repo/") || BUNDLED.has(args.path)) return undefined;
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
