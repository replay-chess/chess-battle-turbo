// Bundles the socket server into dist/index.cjs and the ops signing CLI into dist/cli/internal.js (phase-02 plan 13.1 row D: the workspace packages export TypeScript
// sources, so `tsc` alone cannot emit a runnable server). npm dependencies stay external (installed in the image);
// @repo/* sources are bundled. The generated Prisma client is NOT bundled (its query engine is found next to it):
// `#generated` is rewritten to the relative path of packages/db/generated/prisma from dist/, which exists both in
// the repo and in the Docker runner (/app/packages, /app/apps/web-socket/dist).
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
    // Bare npm specifiers stay external; workspace packages (@repo/*) are bundled from source.
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
  sourcemap: true,
  legalComments: "none",
  plugins: [externals],
  logLevel: "info",
};

await build({ ...common, entryPoints: [resolve(root, "src/index.ts")], outfile: resolve(outdir, "index.cjs"), format: "cjs" });

// `docker compose exec websocket node dist/cli/internal.js broadcast --in 30` (plan 7.11). ESM (`.js` in a
// `"type": "module"` package); it needs only node built-ins and @repo/contracts.
await build({
  ...common,
  entryPoints: [resolve(root, "src/cli/internal.ts")],
  outfile: resolve(outdir, "cli/internal.js"),
  format: "esm",
});
