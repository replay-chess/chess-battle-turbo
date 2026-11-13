// A manual clock for the gate, client and stream tests (the same contract as the worker's `FakeClock` in
// WK/src/scheduler/clock.ts). `advance(ms)` fires every sleep due within the window in order and lets the promise
// chains each one starts settle before the next fires.
import type { Clock } from "../http";

export class FakeClock implements Clock {
  private t: number;
  private seq = 1;
  private readonly timers = new Map<number, { due: number; fire: () => void }>();

  constructor(startMs = Date.UTC(2026, 10, 12, 9, 0, 0)) {
    this.t = startMs;
  }

  now(): number {
    return this.t;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const id = this.seq++;
      const done = () => {
        this.timers.delete(id);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      this.timers.set(id, { due: this.t + Math.max(0, ms), fire: done });
      signal?.addEventListener("abort", done, { once: true });
    });
  }

  get pending(): number {
    return this.timers.size;
  }

  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    await flush();
    for (;;) {
      let nextId: number | null = null;
      let nextDue = Number.POSITIVE_INFINITY;
      for (const [id, { due }] of this.timers) {
        if (due <= end && (due < nextDue || (due === nextDue && id < (nextId ?? Number.POSITIVE_INFINITY)))) {
          nextDue = due;
          nextId = id;
        }
      }
      if (nextId === null) break;
      const timer = this.timers.get(nextId)!;
      this.t = Math.max(this.t, timer.due);
      timer.fire();
      await flush();
    }
    this.t = end;
    await flush();
  }
}

/** Lets pending promise chains settle (macrotask turns). */
export async function flush(turns = 20): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise<void>((r) => setImmediate(r));
}
