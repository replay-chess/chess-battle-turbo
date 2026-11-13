// The lazy start of the service-worker registration (ServiceWorkerRegistration.tsx), testable without React.
//
// A navigation that leaves the page while the lazy chunk is still loading aborts it; WebKit rejects the import with
// "ChunkLoadError: Loading chunk N failed", and an unhandled rejection is a page error (regression:
// sw-chunk-abort, webkit-iphone review-walkthrough `?m=2` on a production build). Registration is best-effort: the
// next page load registers again, so a chunk that did not load ends the attempt quietly.
type Logger = { error(message: string, error?: unknown): void };
type Loaded = { start(onError: (error: unknown) => void): () => void; logger: Logger };

/** Loads the registration code, starts it unless unmounted first; returns the effect's clean-up. */
export function bootServiceWorker(load: () => Promise<Loaded>): () => void {
  let stop: (() => void) | null = null;
  let unmounted = false;
  load().then(
    ({ start, logger }) => {
      if (unmounted) return;
      stop = start((error) => {
        console.error("[pwa] service worker registration failed", error);
        logger.error("service worker registration failed", error);
      });
    },
    () => {
      // The chunk did not load (aborted by a navigation, or a deploy replaced it): nothing to register this time.
    },
  );
  return () => {
    unmounted = true;
    stop?.();
  };
}
