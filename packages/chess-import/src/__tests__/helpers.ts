// Test doubles for the client tests: a recording fetch, JSON / NDJSON responses and a fetch that never answers
// (until its signal aborts). Every request is recorded with its URL and headers.
import type { FetchLike } from "../http";

export interface Recorded {
  url: string;
  headers: Record<string, string>;
  at: number;
}

export type Handler = (url: string, init: RequestInit, n: number) => Response | Promise<Response>;

export function recordingFetch(handler: Handler, now: () => number = () => 0) {
  const calls: Recorded[] = [];
  let active = 0;
  let maxActive = 0;
  const fetch: FetchLike = async (url, init) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    calls.push({ url, headers, at: now() });
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      return await handler(url, init, calls.length);
    } finally {
      active -= 1;
    }
  };
  return {
    fetch,
    calls,
    get maxActive() {
      return maxActive;
    },
  };
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export const empty = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 304 ? null : "", { status, headers });

/** A fetch result that settles only when the request's signal aborts (then rejects like undici does). */
export const hang = (init: RequestInit): Promise<Response> =>
  new Promise((_, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });

/** A byte stream the test pushes chunks into (`push`), ends (`close`) or fails (`error`). */
export function pushStream() {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
    },
  });
  const enc = new TextEncoder();
  return {
    stream,
    push: (s: string | Uint8Array) => ctl.enqueue(typeof s === "string" ? enc.encode(s) : s),
    close: () => ctl.close(),
    error: (e: unknown) => ctl.error(e),
  };
}

/** A stream of the given chunks, then end. */
export function chunkStream(chunks: readonly (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(typeof ch === "string" ? enc.encode(ch) : ch);
      c.close();
    },
  });
}
