// NDJSON stream parser (phase-04 plan §8.7 step 2): a `TextDecoderStream` line splitter that handles lines split
// across chunks, CRLF, multi-byte characters split across chunks and a trailing line without `\n`. A line that fails
// `JSON.parse` is skipped and counted (`stats.invalid`). Optional idle and total deadlines run on an injected clock
// (the worker's export stream: idle 30 s, total 10 min, §7.8); an AbortSignal stops the stream mid-way.
import { realClock, type Clock } from "../http";

export interface NdjsonStats {
  /** Non-empty lines seen. */
  lines: number;
  /** Lines that were not JSON (or were longer than `maxLineChars`). */
  invalid: number;
}

export class StreamTimeoutError extends Error {
  readonly which: "idle" | "total";
  constructor(which: "idle" | "total", ms: number) {
    super(`stream ${which} timeout after ${ms} ms`);
    this.name = "StreamTimeoutError";
    this.which = which;
  }
}

export class StreamAbortedError extends Error {
  constructor() {
    super("stream aborted");
    this.name = "StreamAbortedError";
  }
}

export interface NdjsonOptions {
  signal?: AbortSignal;
  clock?: Clock;
  /** Longest wait for the next chunk. */
  idleTimeoutMs?: number;
  /** Longest time for the whole stream, from the first read. */
  totalTimeoutMs?: number;
  /** Counters, filled as the stream is read (pass your own object to read them afterwards). */
  stats?: NdjsonStats;
  /** A line longer than this is dropped and counted invalid (guards memory against a stream without newlines). */
  maxLineChars?: number;
}

export const NDJSON_MAX_LINE_CHARS = 4_000_000;

type ReadOutcome =
  | { kind: "chunk"; value: string }
  | { kind: "done" }
  | { kind: "timeout"; which: "idle" | "total"; ms: number }
  | { kind: "abort" };

const never = new Promise<never>(() => undefined);

/** Yields one parsed JSON value per non-empty line. */
export async function* ndjsonLines(body: ReadableStream<Uint8Array>, opts: NdjsonOptions = {}): AsyncGenerator<unknown> {
  const clock = opts.clock ?? realClock;
  const stats = opts.stats ?? { lines: 0, invalid: 0 };
  const maxLine = opts.maxLineChars ?? NDJSON_MAX_LINE_CHARS;
  const startedAt = clock.now();
  const signal = opts.signal;
  if (signal?.aborted) throw new StreamAbortedError();

  // lib.dom types TextDecoderStream's writable side as BufferSource, which a Uint8Array stream satisfies at runtime.
  // TransformStream (not lib.dom's ReadableWritablePair) is also a global of @types/node, so a no-DOM consumer (the
  // analysis worker) type-checks this file too.
  const decoder = new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>;
  const reader = body.pipeThrough(decoder).getReader();
  const abortP: Promise<ReadOutcome> = signal
    ? new Promise((resolve) => signal.addEventListener("abort", () => resolve({ kind: "abort" }), { once: true }))
    : never;

  const read = async (): Promise<ReadOutcome> => {
    const next: Promise<ReadOutcome> = reader
      .read()
      .then((r) => (r.done ? { kind: "done" } : { kind: "chunk", value: r.value }));
    next.catch(() => undefined); // a read that loses the race and then fails must not surface as unhandled
    const races: Promise<ReadOutcome>[] = [next, abortP];
    const stop = new AbortController();
    const now = clock.now();
    const idle = opts.idleTimeoutMs ?? Number.POSITIVE_INFINITY;
    const totalLeft = opts.totalTimeoutMs == null ? Number.POSITIVE_INFINITY : startedAt + opts.totalTimeoutMs - now;
    const wait = Math.min(idle, totalLeft);
    if (Number.isFinite(wait)) {
      const which = totalLeft <= idle ? "total" : "idle";
      const ms = which === "total" ? (opts.totalTimeoutMs ?? 0) : idle;
      races.push(
        clock
          .sleep(Math.max(0, wait), stop.signal)
          .then((): Promise<ReadOutcome> => (stop.signal.aborted ? never : Promise.resolve({ kind: "timeout", which, ms }))),
      );
    }
    try {
      return await Promise.race(races);
    } finally {
      stop.abort();
    }
  };

  let buffer = "";
  let discarding = false;
  const emit = function* (line: string): Generator<unknown> {
    const l = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (l.trim() === "") return;
    stats.lines += 1;
    let value: unknown;
    try {
      value = JSON.parse(l);
    } catch {
      stats.invalid += 1;
      return;
    }
    yield value;
  };

  try {
    for (;;) {
      const r = await read();
      if (r.kind === "abort") throw new StreamAbortedError();
      if (r.kind === "timeout") throw new StreamTimeoutError(r.which, r.ms);
      if (r.kind === "done") break;
      buffer += r.value;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (discarding) {
          discarding = false;
          continue;
        }
        yield* emit(line);
        if (signal?.aborted) throw new StreamAbortedError();
      }
      if (buffer.length > maxLine) {
        if (!discarding) {
          stats.lines += 1;
          stats.invalid += 1;
        }
        discarding = true;
        buffer = "";
      }
    }
    if (!discarding) yield* emit(buffer);
    buffer = "";
  } finally {
    reader.cancel().catch(() => undefined);
  }
}
