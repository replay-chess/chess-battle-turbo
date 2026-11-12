// Time for the scheduler, the heartbeat and the lag pause, behind an interface so the timer audit (§12.1) can run 24
// simulated hours in milliseconds.
export interface TimerHandle {
  readonly id: number;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle | null | undefined): void;
  /** Resolves after `ms` (or at once when the signal aborts). */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

/** Node's setTimeout caps at 2^31−1 ms; longer sleeps are chained. */
const MAX_NODE_TIMEOUT_MS = 2_147_483_647;

export function realClock(): Clock {
  const handles = new Map<number, NodeJS.Timeout>();
  let next = 1;
  const clock: Clock = {
    now: () => Date.now(),
    setTimeout(fn, ms) {
      const id = next++;
      const due = Date.now() + Math.max(0, ms);
      const arm = () => {
        const left = due - Date.now();
        if (left > MAX_NODE_TIMEOUT_MS) {
          handles.set(id, setTimeout(arm, MAX_NODE_TIMEOUT_MS));
          return;
        }
        handles.set(
          id,
          setTimeout(() => {
            handles.delete(id);
            fn();
          }, Math.max(0, left)),
        );
      };
      arm();
      return { id };
    },
    clearTimeout(handle) {
      if (!handle) return;
      const t = handles.get(handle.id);
      if (t) clearTimeout(t);
      handles.delete(handle.id);
    },
    sleep(ms, signal) {
      return sleepWith(clock, ms, signal);
    },
  };
  return clock;
}

function sleepWith(clock: Clock, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clock.clearTimeout(handle);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const handle = clock.setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * A manual clock for tests. `advance(ms)` fires every timer due within the window in order, letting the promise
 * chains each one starts run to completion (macrotask turns) before the next fires.
 */
export class FakeClock implements Clock {
  private t: number;
  private seq = 1;
  private readonly timers = new Map<number, { due: number; fn: () => void }>();

  constructor(startMs = Date.UTC(2026, 10, 11, 0, 0, 0)) {
    this.t = startMs;
  }

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.seq++;
    this.timers.set(id, { due: this.t + Math.max(0, ms), fn });
    return { id };
  }

  clearTimeout(handle: TimerHandle | null | undefined): void {
    if (handle) this.timers.delete(handle.id);
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return sleepWith(this, ms, signal);
  }

  /** Pending timers (the timer audit asserts there is at most the one scheduler sleep). */
  get pending(): number {
    return this.timers.size;
  }

  /** The due time of the earliest pending timer. */
  get nextDue(): number | null {
    let min: number | null = null;
    for (const { due } of this.timers.values()) min = min === null ? due : Math.min(min, due);
    return min;
  }

  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    await flush();
    for (;;) {
      let nextId: number | null = null;
      let nextDue = Infinity;
      for (const [id, { due }] of this.timers) {
        if (due <= end && (due < nextDue || (due === nextDue && id < (nextId ?? Infinity)))) {
          nextDue = due;
          nextId = id;
        }
      }
      if (nextId === null) break;
      const timer = this.timers.get(nextId)!;
      this.timers.delete(nextId);
      this.t = Math.max(this.t, timer.due);
      timer.fn();
      await flush();
    }
    this.t = end;
    await flush();
  }
}

/** Lets pending promise chains (and their I/O-free continuations) settle. */
export async function flush(turns = 20): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise<void>((r) => setImmediate(r));
}
