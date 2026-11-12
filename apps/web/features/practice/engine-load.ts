// Practice's engine start with a determinate progress bar (phase-03 plan §4.8 `engine_loading`: "Starting the engine
// · 34%", "First load only: about 7 MB, cached after this."). P2's shared engine (features/engine) loads the hashed
// Stockfish WASM inside its worker and reports no byte progress, so the page first fetches the same WASM URL itself and
// counts the bytes as they stream: the files are immutable and hashed (cache headers `immutable`, the Service Worker's
// CacheFirst `rc-engine-v18`), so the worker's own fetch is then a cache hit and nothing downloads twice. Then the
// engine's `init()` (spawn + `uciok`). The fetch is only a progress meter: if it fails, `init()` still decides.
//
// Progress: 0–90 % follows the bytes (Content-Length, or the build's known size when the header is missing), 90–100 %
// is the engine starting. A cached engine jumps straight to 90 %.

/** The lite engine's WASM is about 7 MB (the copy says "about 7 MB"); used when the response has no Content-Length. */
export const ENGINE_WASM_BYTES_ESTIMATE = 7_300_000;
/** The share of the bar the download fills; the rest is the engine's own start. */
export const DOWNLOAD_SHARE = 90;

export type ProgressFn = (pct: number) => void;

/** The bar value for `loaded` of `total` bytes (never 100 before the engine is up). */
export function downloadPct(loaded: number, total: number | null): number {
  const t = total && total > 0 ? total : ENGINE_WASM_BYTES_ESTIMATE;
  return Math.min(DOWNLOAD_SHARE, Math.floor((loaded / t) * DOWNLOAD_SHARE));
}

/**
 * Fetches `url` to the HTTP cache while reporting progress. Resolves when the body is read (or the fetch failed: the
 * engine start is the real test). Never throws.
 */
export async function prefetchWithProgress(url: string, onProgress: ProgressFn, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    // The same request the engine worker makes (default mode and credentials), so its fetch reuses this cache entry.
    const res = await fetchImpl(url);
    if (!res.ok) return;
    const header = Number(res.headers.get("content-length") ?? "");
    const total = Number.isFinite(header) && header > 0 ? header : null;
    const reader = res.body?.getReader();
    if (!reader) {
      await res.arrayBuffer();
      onProgress(DOWNLOAD_SHARE);
      return;
    }
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value?.byteLength ?? 0;
      onProgress(downloadPct(loaded, total));
    }
    onProgress(DOWNLOAD_SHARE);
  } catch {
    // The meter is best effort; init() reports a real failure.
  }
}

export interface EngineStarter {
  status(): "idle" | "loading" | "ready" | "failed";
  init(): Promise<unknown>;
}

/**
 * Starts the engine with progress: an engine already up → 100 at once; otherwise the metered download, then `init()`.
 * Rejects when the engine fails to start.
 */
export async function startEngineWithProgress(
  engine: EngineStarter,
  wasmUrl: string,
  onProgress: ProgressFn,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (engine.status() === "ready") {
    onProgress(100);
    return;
  }
  onProgress(0);
  await prefetchWithProgress(wasmUrl, onProgress, fetchImpl);
  await engine.init();
  onProgress(100);
}
