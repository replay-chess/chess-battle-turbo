#!/usr/bin/env node
/* global process */
// Engine assets (phase-02 plan 0.2, 7.8, 13.1 WP-H): copies the Stockfish 18 lite single-threaded build from
// public/workers/ into a content-hashed folder public/workers/sf18-<hash>/ together with its GPL-3.0 licence
// (COPYING) and a source pointer (SOURCE.txt), and writes manifest.json. The hashed folder is immutable
// (next.config.js serves /workers/sf18-*/ with `max-age=31536000, immutable`), so a new engine build gets a new URL.
// The same folder is what scripts/upload-engine-r2.mjs puts on R2 (owner-run).
//
// It also keeps ENGINE_HASH in features/engine/manifest.ts equal to the folder name, so the client points at the
// files that were built. Run it before `next build` (and once after cloning, for `next dev`):
//
//   node scripts/build-engine-assets.mjs           # build the folder, fix ENGINE_HASH if needed
//   node scripts/build-engine-assets.mjs --check   # exit 1 when ENGINE_HASH or the folder is out of date (CI)
//
// Idempotent: an up-to-date folder is left alone. Older sf18-* folders are removed.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKERS = path.join(WEB, "public", "workers");
const MANIFEST_TS = path.join(WEB, "features", "engine", "manifest.ts");

export const GLUE = "stockfish-18-lite-single.js";
export const WASM = "stockfish-18-lite-single.wasm";
export const FOLDER_PREFIX = "sf18-";
/** NNUE net embedded in the lite build (header of the glue file). */
const NET = "nn-9067e33176e8.nnue";
const UPSTREAM = "https://github.com/nmrugg/stockfish.js";
const STOCKFISH = "https://github.com/official-stockfish/Stockfish";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** The folder hash: the first 12 hex characters of sha256(sha256(glue) + sha256(wasm)). */
export function engineHash(glue, wasm) {
  return sha256(`${sha256(glue)}\n${sha256(wasm)}\n`).slice(0, 12);
}

/** The stockfish npm package (its Copying.txt is the GPL-3.0 text; its version names the upstream tag). */
async function stockfishPackage() {
  const require = createRequire(path.join(WEB, "package.json"));
  let pkgJson;
  try {
    pkgJson = require.resolve("stockfish/package.json");
  } catch {
    throw new Error("the `stockfish` package is not installed (apps/web dependency); run pnpm install");
  }
  const dir = path.dirname(pkgJson);
  const { version } = JSON.parse(await readFile(pkgJson, "utf8"));
  const copying = await readFile(path.join(dir, "Copying.txt"), "utf8");
  if (!/GNU GENERAL PUBLIC LICENSE\s+Version 3/.test(copying)) throw new Error("stockfish/Copying.txt is not the GPL-3.0 text");
  return { version, copying, dir };
}

export function sourceText({ version, hash, glueSha, wasmSha }) {
  return `Stockfish chess engine (WebAssembly build "lite single-threaded") used by Replay Chess
=====================================================================================

These files are the unmodified "stockfish-18-lite-single" build of Stockfish.js ${version}
(npm package "stockfish@${version}"), a WebAssembly port of the Stockfish chess engine.

  Engine:           Stockfish 18, ${STOCKFISH}
  WebAssembly port: Stockfish.js ${version} by Nathan Rugg and Chess.com, ${UPSTREAM}
  Source (tag):     ${UPSTREAM}/tree/v${version}
  Release files:    ${UPSTREAM}/releases/tag/v${version}
  npm package:      https://www.npmjs.com/package/stockfish/v/${version}
  NNUE network:     ${NET} (https://tests.stockfishchess.org/nns?network_name=${NET.replace(/\.nnue$/, "")})
  Folder:           ${FOLDER_PREFIX}${hash}
  sha256 ${GLUE}:   ${glueSha}
  sha256 ${WASM}: ${wasmSha}

Licence: GNU General Public License version 3 (GPL-3.0). The full text is in the file COPYING in this folder.
The engine runs as a separate program in a Web Worker; it is not linked into or bundled with the Replay Chess
application code.

Written offer of source: the complete corresponding source code of these files is available at the URLs above.
For at least three years after we last distribute these files, anyone may also ask us for a copy of the
complete corresponding source code by writing to hello@playchess.tech; we will provide it for no more than our
cost of physically performing the distribution.
`;
}

async function readIfExists(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

/** Rewrites `export const ENGINE_HASH = "…";` in manifest.ts. Returns true when the file changed. */
async function syncManifestTs(hash, { check }) {
  const ts = await readFile(MANIFEST_TS, "utf8");
  const re = /export const ENGINE_HASH = "([0-9a-f]*)";/;
  const m = re.exec(ts);
  if (!m) throw new Error(`ENGINE_HASH declaration not found in ${path.relative(WEB, MANIFEST_TS)}`);
  if (m[1] === hash) return false;
  if (check) return true;
  await writeFile(MANIFEST_TS, ts.replace(re, `export const ENGINE_HASH = "${hash}";`));
  return true;
}

export async function buildEngineAssets({ check = false, log = console.log } = {}) {
  const [glue, wasm] = await Promise.all([readFile(path.join(WORKERS, GLUE)), readFile(path.join(WORKERS, WASM))]);
  const hash = engineHash(glue, wasm);
  const folder = `${FOLDER_PREFIX}${hash}`;
  const out = path.join(WORKERS, folder);
  const pkg = await stockfishPackage();
  const glueSha = sha256(glue);
  const wasmSha = sha256(wasm);

  const manifest = {
    v: 1,
    engine: "stockfish",
    version: pkg.version,
    flavor: "lite-single",
    hash,
    folder,
    net: NET,
    license: "GPL-3.0",
    files: {
      glue: { name: GLUE, bytes: glue.length, sha256: glueSha, contentType: "text/javascript; charset=utf-8" },
      wasm: { name: WASM, bytes: wasm.length, sha256: wasmSha, contentType: "application/wasm" },
      copying: { name: "COPYING", contentType: "text/plain; charset=utf-8" },
      source: { name: "SOURCE.txt", contentType: "text/plain; charset=utf-8" },
    },
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const source = sourceText({ version: pkg.version, hash, glueSha, wasmSha });

  const upToDate =
    (await readIfExists(path.join(out, "manifest.json"))) === manifestText &&
    (await readIfExists(path.join(out, "SOURCE.txt"))) === source &&
    (await readIfExists(path.join(out, "COPYING"))) === pkg.copying &&
    existsSync(path.join(out, GLUE)) &&
    existsSync(path.join(out, WASM));

  const stale = (await readdir(WORKERS, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && d.name.startsWith(FOLDER_PREFIX) && d.name !== folder)
    .map((d) => d.name);

  if (check) {
    const tsStale = await syncManifestTs(hash, { check: true });
    const problems = [];
    if (tsStale) problems.push(`features/engine/manifest.ts ENGINE_HASH is not "${hash}"`);
    if (!upToDate) problems.push(`public/workers/${folder}/ is missing or out of date`);
    if (problems.length) {
      for (const p of problems) log(`engine assets: ${p}`);
      log("engine assets: run `node scripts/build-engine-assets.mjs`");
      return { ok: false, hash, folder };
    }
    log(`engine assets: ${folder} up to date`);
    return { ok: true, hash, folder };
  }

  if (!upToDate) {
    await rm(out, { recursive: true, force: true });
    await mkdir(out, { recursive: true });
    await Promise.all([copyFile(path.join(WORKERS, GLUE), path.join(out, GLUE)), copyFile(path.join(WORKERS, WASM), path.join(out, WASM))]);
    await writeFile(path.join(out, "COPYING"), pkg.copying);
    await writeFile(path.join(out, "SOURCE.txt"), source);
    await writeFile(path.join(out, "manifest.json"), manifestText); // last: its presence marks a complete folder
    log(`engine assets: wrote public/workers/${folder}/ (${(wasm.length / 1e6).toFixed(1)} MB wasm)`);
  } else {
    log(`engine assets: public/workers/${folder}/ up to date`);
  }
  for (const name of stale) {
    await rm(path.join(WORKERS, name), { recursive: true, force: true });
    log(`engine assets: removed stale public/workers/${name}/`);
  }
  if (await syncManifestTs(hash, { check: false })) log(`engine assets: ENGINE_HASH set to "${hash}" in features/engine/manifest.ts`);
  return { ok: true, hash, folder };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  buildEngineAssets({ check: process.argv.includes("--check") }).then(
    (r) => process.exit(r.ok ? 0 : 1),
    (err) => {
      console.error(`engine assets: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
}
