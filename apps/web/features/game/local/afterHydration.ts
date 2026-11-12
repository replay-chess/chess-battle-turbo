// When the local (bot) controller may start writing to the game store after the screen mounts (useLocalGame attach).
//
// The next animation frame plus a task, so the first writes land after hydration has finished (an early write while
// parts of the screen are still hydrating showed up as a hydration mismatch). But never only on a frame: a page that
// gets no animation frames (a background tab, or WebKit not rendering under load) would then never resume. CI run
// 43226863882 (webkit-iphone, bot-game): after the reload the board sat at the server snapshot's ply 11 while the
// device's journal held ply 13, for the whole 30 s wait; the same starved frames kept React's streamed copy of the
// screen (Fizz's `$RC` reveal also waits for a frame) in the document. A timer starts the controller if no frame came.

/** Starts the controller this long after mount when no animation frame has run by then. */
export const AFTER_HYDRATION_FALLBACK_MS = 300;

export type FrameEnv = {
  raf?: (cb: () => void) => unknown;
  setTimeout: (cb: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

const browserEnv = (): FrameEnv => ({
  raf: typeof requestAnimationFrame === "function" ? (cb) => requestAnimationFrame(() => cb()) : undefined,
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
});

/** Runs `fn` once: after the next frame and a task, or after the fallback, whichever comes first. */
export function afterHydration(fn: () => void, env: FrameEnv = browserEnv(), fallbackMs = AFTER_HYDRATION_FALLBACK_MS): void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    env.clearTimeout(timer);
    fn();
  };
  const timer = env.setTimeout(run, fallbackMs);
  env.raf?.(() => env.setTimeout(run, 0));
}
