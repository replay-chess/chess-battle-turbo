// The one HTTP path both provider clients use (phase-04 plan §7.8): anonymous, a User-Agent with a contact
// (R-CC-03), an injectable base URL (the e2e upstream mock, `CHESSCOM_API_BASE` / `LICHESS_BASE_URL`), an
// injectable `fetch`, and a per-call timeout that runs on an injectable clock so tests never wait for real time.
// Status codes become a `ProviderError` here, once, so the two clients and the worker agree on the kinds.
import { ProviderError, type Provider } from "./errors";

/** The contact in the User-Agent when `UPSTREAM_CONTACT` is unset (§7.9). */
export const DEFAULT_CONTACT = "hello@playchess.tech";
export const PRODUCT_URL = "https://playchess.tech";

/** `ReplayChess/1.0 (+https://playchess.tech; hello@playchess.tech)` (§7.8). */
export function userAgent(contact: string = DEFAULT_CONTACT): string {
  const c = contact.trim() || DEFAULT_CONTACT;
  if (/[\r\n()]/.test(c)) throw new RangeError("UPSTREAM_CONTACT must be a plain address");
  return `ReplayChess/1.0 (+${PRODUCT_URL}; ${c})`;
}

/** Time behind an interface; structurally the worker's `Clock` (WK/src/scheduler/clock.ts) satisfies it. */
export interface Clock {
  now(): number;
  /** Resolves after `ms`, or at once when `signal` aborts. Never rejects. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const done = () => {
        clearTimeout(t);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const t = setTimeout(done, Math.max(0, ms));
      signal?.addEventListener("abort", done, { once: true });
    }),
};

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Normalises an injected base URL: http(s) only, no trailing slash, no query or fragment. */
export function normaliseBaseUrl(raw: string, name: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new RangeError(`${name} is not a URL`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new RangeError(`${name} must be http(s)`);
  if (u.search || u.hash) throw new RangeError(`${name} must not carry a query or fragment`);
  return u.toString().replace(/\/+$/, "");
}

/** `Retry-After` as seconds (delta-seconds or an HTTP date); null when absent or unparsable. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (value == null) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v);
  const at = Date.parse(v);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - nowMs) / 1000));
}

/** Maps a non-2xx, non-304 response to its error kind (§7.8 "Errors →"). */
export function errorForStatus(provider: Provider, status: number, retryAfterSec: number | null): ProviderError {
  if (status === 404) return new ProviderError(provider, "not_found", `${provider} 404`, { status });
  if (status === 410) return new ProviderError(provider, "closed", `${provider} 410`, { status });
  if (status === 429)
    return new ProviderError(provider, "rate_limited", `${provider} 429`, { status, retryAfterSec });
  return new ProviderError(provider, "upstream", `${provider} ${status}`, {
    status,
    retryAfterSec: status === 503 ? retryAfterSec : null,
  });
}

export interface HttpDeps {
  provider: Provider;
  fetch: FetchLike;
  clock: Clock;
  userAgent: string;
}

export interface CallOptions {
  /** Aborts the call; surfaces as `ProviderError` kind `aborted`. */
  signal?: AbortSignal;
}

/**
 * Runs `work` with an AbortSignal that fires after `timeoutMs` on `clock` or when `outer` aborts. A timeout becomes
 * `ProviderError` `timeout`, an outer abort `aborted`; anything else `work` throws passes through.
 */
export async function withDeadline<T>(
  deps: Pick<HttpDeps, "provider" | "clock">,
  timeoutMs: number,
  outer: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const { provider, clock } = deps;
  if (outer?.aborted) throw new ProviderError(provider, "aborted", `${provider} call aborted`);
  const ctl = new AbortController();
  const stopTimer = new AbortController();
  let timedOut = false;
  const onOuter = () => ctl.abort(new Error("aborted"));
  outer?.addEventListener("abort", onOuter, { once: true });
  void clock.sleep(timeoutMs, stopTimer.signal).then(() => {
    if (stopTimer.signal.aborted) return;
    timedOut = true;
    ctl.abort(new Error("timeout"));
  });
  // `work` may ignore the signal (an injected fetch that never settles): race it against the abort.
  const aborted = new Promise<never>((_, reject) => {
    ctl.signal.addEventListener("abort", () => reject(new Error("deadline")), { once: true });
  });
  aborted.catch(() => undefined);
  try {
    const running = work(ctl.signal);
    running.catch(() => undefined); // a loser of the race must not surface as an unhandled rejection
    return await Promise.race([running, aborted]);
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (timedOut) throw new ProviderError(provider, "timeout", `${provider} timed out after ${timeoutMs} ms`);
    if (outer?.aborted) throw new ProviderError(provider, "aborted", `${provider} call aborted`);
    throw new ProviderError(provider, "upstream", `${provider} network error`, { cause: e });
  } finally {
    stopTimer.abort();
    outer?.removeEventListener("abort", onOuter);
  }
}

/** HTTP validators for conditional GETs (R-CC-04). Values are echoed back verbatim. */
export interface Validators {
  etag?: string | null;
  lastModified?: string | null;
}

export type JsonResult =
  | { status: 200; body: unknown; etag: string | null; lastModified: string | null }
  | { status: 304; etag: string | null; lastModified: string | null };

/** GET a JSON document; 2xx → parsed body, 304 → unchanged, anything else → `ProviderError`. */
export async function getJson(
  deps: HttpDeps,
  url: string,
  opts: CallOptions & { timeoutMs: number; validators?: Validators; accept?: string },
): Promise<JsonResult> {
  const headers: Record<string, string> = {
    "User-Agent": deps.userAgent,
    Accept: opts.accept ?? "application/json",
  };
  if (opts.validators?.etag) headers["If-None-Match"] = opts.validators.etag;
  if (opts.validators?.lastModified) headers["If-Modified-Since"] = opts.validators.lastModified;
  return withDeadline(deps, opts.timeoutMs, opts.signal, async (signal) => {
    const res = await deps.fetch(url, { method: "GET", headers, signal, redirect: "follow" });
    const etag = res.headers.get("etag");
    const lastModified = res.headers.get("last-modified");
    if (res.status === 304) {
      await res.body?.cancel();
      return { status: 304, etag, lastModified };
    }
    if (res.status < 200 || res.status > 299) {
      await res.body?.cancel();
      throw errorForStatus(deps.provider, res.status, parseRetryAfter(res.headers.get("retry-after"), deps.clock.now()));
    }
    const text = await res.text();
    try {
      return { status: 200, body: JSON.parse(text) as unknown, etag, lastModified };
    } catch {
      throw new ProviderError(deps.provider, "bad_response", `${deps.provider} sent a body that is not JSON`, {
        status: res.status,
      });
    }
  });
}
