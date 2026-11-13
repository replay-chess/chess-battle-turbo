// Lazy chunks that fail to load are retried before anything gives up (CI runs 43401675366 and 43409659970).
//
// Every lazy chunk of the client (next/dynamic, React.lazy, the route chunks the App Router loads from the RSC payload)
// goes through webpack's `__webpack_require__.e`. A load can fail for reasons that pass:
// - the document is being left (a reload, a full navigation): WebKit aborts the in-flight script and webpack rejects
//   with "ChunkLoadError: Loading chunk 4654 failed", which React or the lazy loader then logs on the dying page
//   (webkit-iphone review-walkthrough, the `?m=2` reload, chunks 264 / 4654 / 7153);
// - the service worker answered 504 because its network fetch failed with nothing cached (sw: CacheFirst on
//   /_next/static), or the network blipped.
// webpack forgets a failed chunk, so asking again reloads it. `installChunkRetry()` wraps `.e` once with retries at
// 0.5 s, 1.5 s and 3 s: a transient failure recovers, and on a page being left the retry outlives the document, so no
// error is ever reported there. A chunk that is really gone (a deploy replaced it) still fails after ~5 s, as before.

export const CHUNK_RETRY_DELAYS_MS = [500, 1_500, 3_000] as const;

type EnsureChunk = ((chunkId: string | number) => Promise<unknown>) & { rcRetry?: true };

/** webpack's chunk-load rejection (JS or CSS), by name or message. */
export function isChunkLoadError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; message?: unknown };
  return e.name === "ChunkLoadError" || (typeof e.message === "string" && /^Loading (?:CSS )?chunk \S+ failed/.test(e.message));
}

/** `load` with the retries: only chunk-load errors are retried; the last one is thrown after the last delay. */
export function retryingChunkLoader(
  load: EnsureChunk,
  delays: readonly number[] = CHUNK_RETRY_DELAYS_MS,
  wait: (ms: number) => Promise<unknown> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): EnsureChunk {
  const wrapped: EnsureChunk = async (chunkId) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await load(chunkId);
      } catch (err) {
        const delay = delays[attempt];
        if (delay === undefined || !isChunkLoadError(err)) throw err;
        await wait(delay);
      }
    }
  };
  wrapped.rcRetry = true;
  return wrapped;
}

// webpack's runtime require in the browser bundle (a free variable webpack provides; undefined under tsx/node).
declare const __webpack_require__: { e?: EnsureChunk } | undefined;

/** Wraps the browser bundle's chunk loader once. Returns whether the retries are in place. */
export function installChunkRetry(): boolean {
  if (typeof window === "undefined" || typeof __webpack_require__ === "undefined") return false;
  const runtime = __webpack_require__;
  const ensure = runtime?.e;
  if (typeof ensure !== "function") return false;
  if (ensure.rcRetry) return true;
  runtime.e = retryingChunkLoader(ensure);
  return true;
}
