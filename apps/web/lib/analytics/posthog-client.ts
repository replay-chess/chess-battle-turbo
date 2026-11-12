// The PostHog browser client, loaded on demand (FIX-1). `posthog-js` (~105 kB gzipped with its recorder) used to be a
// static import of instrumentation-client.ts and of every event helper, so it shipped in the shared chunk of every
// route, even where no key is set (local, CI, the test builds) and on the public share page, whose Lighthouse gate
// (G5) it held down. Now it is a separate chunk that only loads when NEXT_PUBLIC_POSTHOG_KEY is set: instrumentation-
// client.ts calls `loadPosthog` once, and the helpers go through `withPosthog`, which runs at once when the client is
// ready and otherwise queues (bounded) until the init finishes. Without a key nothing is loaded or queued.
import type { PostHog } from "posthog-js";

/** Calls made before the client finished loading wait here (oldest dropped past the cap). */
export const POSTHOG_QUEUE_MAX = 100;

let client: PostHog | null = null;
let loading = false;
const queue: ((ph: PostHog) => void)[] = [];

function enabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY) && typeof window !== "undefined";
}

/** Loads and initialises the client once (instrumentation-client.ts), then runs what was queued. */
export function loadPosthog(
  init: (ph: PostHog) => void,
  importer: () => Promise<{ default: PostHog }> = () => import("posthog-js"),
): void {
  if (!enabled() || loading || client) return;
  loading = true;
  void importer()
    .then(({ default: ph }) => {
      init(ph);
      client = ph;
      for (const fn of queue.splice(0)) {
        try {
          fn(ph);
        } catch {
          // Telemetry never breaks the app.
        }
      }
    })
    .catch(() => {
      queue.length = 0;
    });
}

/** Runs `fn` with the initialised client, now or once it has loaded; a no-op without a key. */
export function withPosthog(fn: (ph: PostHog) => void): void {
  if (!enabled()) return;
  if (client) {
    try {
      fn(client);
    } catch {
      // Telemetry never breaks the app.
    }
    return;
  }
  if (queue.length >= POSTHOG_QUEUE_MAX) queue.shift();
  queue.push(fn);
}

/** `posthog.capture` through the lazy client. */
export function capturePosthog(event: string, props: Record<string, unknown>): void {
  withPosthog((ph) => ph.capture(event, props));
}

/** Test seam: forget the client and the queue. */
export function resetPosthogClientForTests(): void {
  client = null;
  loading = false;
  queue.length = 0;
}
