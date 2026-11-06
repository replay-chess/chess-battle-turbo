// Where the engine files live (phase-02 plan 0.2, 7.9, 13.1 WP-H).
//
// The Stockfish 18 lite build is served from a content-hashed folder `sf18-<ENGINE_HASH>/` that
// scripts/build-engine-assets.mjs creates under public/workers/ (and scripts/upload-engine-r2.mjs copies to R2).
// The worker is always the same-origin shim public/workers/engine-shim.js (`new Worker()` needs a same-origin
// script); the shim loads the glue and the WASM from R2 when NEXT_PUBLIC_ENGINE_BASE_URL is set, and from the
// hashed same-origin folder otherwise or when R2 fails.
//
// ENGINE_HASH is kept in step with the files by build-engine-assets.mjs (it rewrites the line below); `--check`
// fails CI when they drift. Do not edit it by hand.

export const ENGINE_HASH = "1a3515d5bd9d";

export const ENGINE_GLUE = "stockfish-18-lite-single.js";
export const ENGINE_WASM = "stockfish-18-lite-single.wasm";
export const ENGINE_SHIM = "/workers/engine-shim.js";

export type EngineSource = "r2" | "origin";

/** `/workers/sf18-<hash>/`: the same-origin copy (local, CI and the R2 fallback). */
export function originBase(hash: string = ENGINE_HASH): string {
  return `/workers/sf18-${hash}/`;
}

/**
 * The R2 folder from NEXT_PUBLIC_ENGINE_BASE_URL (`https://media.playchess.tech/engine/sf18-<hash>/`), or null when
 * unset or unusable. Only https URLs are accepted; a trailing slash is added. When the URL names a different
 * `sf18-<hash>` folder than this build, it is ignored (a stale env value must not load a mismatched engine).
 */
export function remoteBase(raw: string | undefined = process.env.NEXT_PUBLIC_ENGINE_BASE_URL, hash: string = ENGINE_HASH): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.search || url.hash) return null;
  const base = url.href.endsWith("/") ? url.href : `${url.href}/`;
  const named = /\/sf18-([0-9a-f]+)\/$/.exec(base);
  if (named && named[1] !== hash) return null;
  return base;
}

export interface EngineUrls {
  /** The worker script: the shim with its configuration in the query and the WASM URL in the fragment. */
  worker: string;
  /** Where the shim tries first. */
  source: EngineSource;
  glue: string;
  wasm: string;
}

/**
 * The shim URL. The Stockfish.js glue reads the WASM location from the worker's `location.hash`
 * (`#<encoded wasm url>`), so the fragment carries it; `o` and `r` tell the shim where the glue lives.
 */
export function engineUrls(opts: { remote?: string | null; hash?: string } = {}): EngineUrls {
  const origin = originBase(opts.hash);
  const remote = opts.remote === undefined ? remoteBase(undefined, opts.hash) : opts.remote;
  const base = remote ?? origin;
  const query = new URLSearchParams({ o: origin });
  if (remote) query.set("r", remote);
  const wasm = `${base}${ENGINE_WASM}`;
  return {
    worker: `${ENGINE_SHIM}?${query.toString()}#${encodeURIComponent(wasm)}`,
    source: remote ? "r2" : "origin",
    glue: `${base}${ENGINE_GLUE}`,
    wasm,
  };
}

/** The Service Worker cache that holds the engine (plan 9.3); "Try again" deletes the engine entries from it. */
export const ENGINE_SW_CACHE = "rc-engine-v18";
