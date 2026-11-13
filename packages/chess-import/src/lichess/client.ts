// Lichess client (phase-04 plan §7.8, §8.7). Always anonymous (D4-21: no token is ever stored, so the worker's
// export runs at the anonymous 20 games/s), one stream at a time through a `ProviderGate` (R-LI-06), a User-Agent
// with a contact, an injectable base URL (`LICHESS_BASE_URL`: the e2e upstream mock) and fetch, and the export's
// idle 30 s / total 10 min deadlines on an injectable clock. The OAuth calls (`/api/token`, `/api/account`,
// `DELETE /api/token`) belong to the web callback (WEB/lib/accounts/lichess.ts); `lichessSchemas().account` parses
// the account there.
import { describeIssues, ProviderError, isProviderError } from "../errors";
import { ProviderGate, type AcquireOptions } from "../gate";
import {
  errorForStatus,
  getJson,
  normaliseBaseUrl,
  parseRetryAfter,
  realClock,
  userAgent,
  withDeadline,
  type CallOptions,
  type Clock,
  type FetchLike,
  type HttpDeps,
} from "../http";
import { LICHESS_PERF_TYPES, type LichessSpeed } from "../time-class";
import { ndjsonLines, StreamAbortedError, StreamTimeoutError, type NdjsonStats } from "./ndjson";
import { lichessSchemas, type LichessAccount, type SchemaMode } from "./types";

export const LICHESS_BASE_URL_DEFAULT = "https://lichess.org";

export const LICHESS_TIMEOUTS = {
  /** Export stream: longest gap between two chunks (also the wait for the response headers). */
  streamIdleMs: 30_000,
  /** Export stream: the whole stream. */
  streamTotalMs: 600_000,
  /** Web confirm (`max=5`) and `/api/user`. */
  shortMs: 5_000,
} as const;

/** Lichess usernames: 2–30 letters, digits, `_` or `-`, starting and ending with a letter or digit. */
export const LICHESS_USERNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,28}[A-Za-z0-9])?$/;

export interface LichessClientOptions {
  baseUrl?: string;
  contact?: string;
  fetch?: FetchLike;
  clock?: Clock;
  /** The process's Lichess gate. Omitted: the client makes its own; `null`: the caller serialises. */
  gate?: ProviderGate | null;
  schemaMode?: SchemaMode;
  streamIdleMs?: number;
  streamTotalMs?: number;
}

/** §8.7 step 1: `since` / `until` in ms (inclusive, Lichess semantics), `max` games. */
export interface ExportQuery {
  since?: number;
  until?: number;
  max?: number;
  /** One speed instead of every standard one (the worker's correspondence look-back pass, FIX-1). */
  perfType?: LichessSpeed;
}

export type LichessCallOptions = CallOptions & Pick<AcquireOptions, "maxWaitMs">;

export class LichessClient {
  readonly baseUrl: string;
  readonly gate: ProviderGate | null;
  private readonly deps: HttpDeps;
  private readonly mode: SchemaMode;
  private readonly idleMs: number;
  private readonly totalMs: number;

  constructor(opts: LichessClientOptions = {}) {
    this.baseUrl = normaliseBaseUrl(opts.baseUrl ?? LICHESS_BASE_URL_DEFAULT, "LICHESS_BASE_URL");
    const clock = opts.clock ?? realClock;
    this.deps = {
      provider: "lichess",
      fetch: opts.fetch ?? ((input, init) => fetch(input, init)),
      clock,
      userAgent: userAgent(opts.contact),
    };
    this.gate = opts.gate === undefined ? new ProviderGate({ provider: "lichess", clock }) : opts.gate;
    this.mode = opts.schemaMode ?? "lenient";
    this.idleMs = opts.streamIdleMs ?? LICHESS_TIMEOUTS.streamIdleMs;
    this.totalMs = opts.streamTotalMs ?? LICHESS_TIMEOUTS.streamTotalMs;
  }

  private user(username: string): string {
    const u = username.trim();
    if (!LICHESS_USERNAME_RE.test(u)) throw new ProviderError("lichess", "not_found", "not a Lichess username");
    return encodeURIComponent(u.toLowerCase());
  }

  /** The worker's export URL (§7.8 row "worker"); exported for the upstream mock's contract test. */
  exportUrl(username: string, q: ExportQuery): string {
    const p = new URLSearchParams();
    if (q.since != null) p.set("since", String(Math.trunc(q.since)));
    if (q.until != null) p.set("until", String(Math.trunc(q.until)));
    if (q.max != null) p.set("max", String(Math.trunc(q.max)));
    p.set("rated", "true");
    p.set("perfType", q.perfType ?? LICHESS_PERF_TYPES);
    p.set("moves", "true");
    p.set("clocks", "true");
    p.set("evals", "true");
    p.set("opening", "true");
    p.set("finished", "true");
    p.set("pgnInJson", "false");
    p.set("tags", "false");
    return `${this.baseUrl}/api/games/user/${this.user(username)}?${p.toString()}`;
  }

  /**
   * Streams the member's games, newest first, as raw objects (map each with `mapLichessGame`). Holds the gate from
   * the request until the stream ends or the consumer stops; a 429 pauses the gate (60 s → 900 s ladder, R-LI-06).
   * Malformed lines are skipped and counted in `opts.stats.invalid`.
   */
  async *streamGames(
    username: string,
    query: ExportQuery,
    opts: LichessCallOptions & { stats?: NdjsonStats } = {},
  ): AsyncGenerator<unknown> {
    yield* this.stream(this.exportUrl(username, query), opts);
  }

  /** Web confirm: the newest `max` (≤ 10) rated games without moves (§7.8 `max=5&rated=true&moves=false&opening=true`). */
  async recentGames(username: string, max = 5, opts: LichessCallOptions = {}): Promise<unknown[]> {
    const p = new URLSearchParams({
      max: String(Math.max(1, Math.min(10, Math.trunc(max)))),
      rated: "true",
      moves: "false",
      opening: "true",
      pgnInJson: "false",
      tags: "false",
    });
    const url = `${this.baseUrl}/api/games/user/${this.user(username)}?${p.toString()}`;
    const out: unknown[] = [];
    for await (const g of this.stream(url, { ...opts, totalMs: LICHESS_TIMEOUTS.shortMs })) out.push(g);
    return out;
  }

  /** `GET /api/user/{u}`: public profile and perfs (ratings, the canary). 404 → `not_found`; closed → `closed`. */
  async getUser(username: string, opts: LichessCallOptions = {}): Promise<LichessAccount> {
    const url = `${this.baseUrl}/api/user/${this.user(username)}`;
    const run = () => getJson(this.deps, url, { timeoutMs: LICHESS_TIMEOUTS.shortMs, signal: opts.signal });
    const res = this.gate ? await this.gate.run(run, { maxWaitMs: opts.maxWaitMs, signal: opts.signal }) : await run();
    if (res.status === 304) throw new ProviderError("lichess", "bad_response", "unexpected 304 for a user");
    const parsed = lichessSchemas(this.mode).account.safeParse(res.body);
    if (!parsed.success)
      throw new ProviderError(
        "lichess",
        "bad_response",
        `lichess user does not match the schema (${describeIssues(parsed.error.issues)})`,
      );
    if (parsed.data.closed || parsed.data.disabled)
      throw new ProviderError("lichess", "closed", "the Lichess account is closed");
    return parsed.data;
  }

  private async *stream(
    url: string,
    opts: LichessCallOptions & { stats?: NdjsonStats; totalMs?: number },
  ): AsyncGenerator<unknown> {
    const release = this.gate ? await this.gate.acquire({ maxWaitMs: opts.maxWaitMs, signal: opts.signal }) : null;
    const ctl = new AbortController();
    const onOuter = () => ctl.abort(new Error("aborted"));
    opts.signal?.addEventListener("abort", onOuter, { once: true });
    const totalMs = opts.totalMs ?? this.totalMs;
    try {
      const res = await withDeadline(this.deps, Math.min(this.idleMs, totalMs), opts.signal, (signal) =>
        this.deps.fetch(url, {
          method: "GET",
          headers: { "User-Agent": this.deps.userAgent, Accept: "application/x-ndjson" },
          signal: AbortSignal.any([signal, ctl.signal]),
          redirect: "follow",
        }),
      );
      if (res.status < 200 || res.status > 299) {
        await res.body?.cancel().catch(() => undefined);
        throw errorForStatus("lichess", res.status, parseRetryAfter(res.headers.get("retry-after"), this.deps.clock.now()));
      }
      if (!res.body) throw new ProviderError("lichess", "bad_response", "lichess sent no body");
      try {
        for await (const value of ndjsonLines(res.body, {
          signal: ctl.signal,
          clock: this.deps.clock,
          idleTimeoutMs: this.idleMs,
          totalTimeoutMs: totalMs,
          stats: opts.stats,
        })) {
          yield value;
        }
      } catch (e) {
        if (e instanceof StreamTimeoutError)
          throw new ProviderError("lichess", "timeout", `lichess export ${e.which} timeout`, { cause: e });
        if (e instanceof StreamAbortedError || opts.signal?.aborted)
          throw new ProviderError("lichess", "aborted", "lichess export aborted", { cause: e });
        if (isProviderError(e)) throw e;
        throw new ProviderError("lichess", "upstream", "lichess export stream failed", { cause: e });
      }
      this.gate?.succeeded();
    } catch (e) {
      if (isProviderError(e) && e.kind === "rate_limited") this.gate?.pause(e.retryAfterSec);
      throw e;
    } finally {
      opts.signal?.removeEventListener("abort", onOuter);
      ctl.abort(new Error("released"));
      release?.();
    }
  }
}
