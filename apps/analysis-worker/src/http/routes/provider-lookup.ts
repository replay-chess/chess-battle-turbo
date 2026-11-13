// POST /internal/provider/chesscom/lookup (phase-04 plan §7.7.2, §7.7.3, §7.3.1; D4-23, feasibility F-API-1).
//
// The web's fallback when its own Chess.com call got 429 or 403 (Vercel's egress IPs are shared and get limited):
// the same question, asked from the worker's IP with the worker's User-Agent, through the worker's ONE Chess.com
// gate (providers/gate.ts), so the lookup and the imports of this process still never have two Chess.com requests
// in flight. The route is HMAC-signed by the web (kid `webwk`, CT/internal/auth.ts) and parses `InternalLookupBody`
// only after the signature is checked (http/server.ts).
//
//   - gate wait capped at PROVIDER_LOOKUP_GATE_WAIT_MS (5 s): a lookup never queues behind a long import; when the
//     gate is paused past the cap or the cap runs out it answers `rate_limited {retryAfterSec}` at once;
//   - 600 s LRU of ≤ 2,000 answers (`found`, `private`, `not_found`; a `rate_limited` is never cached), on the worker
//     clock, so a user retyping a handle or the confirm step after the lookup costs no second upstream call;
//   - the web's per-call timeouts (5 s, `caller: "web"`), so the answer fits the web's 6 s budget;
//   - outcomes: 200 `InternalLookupData` for everything the web can act on; a timeout / 5xx / bad body is a 502
//     `{error: "upstream", kind}` (the web's 502 `upstream_unavailable`).
//
// `profile+stats`: profile, then stats (serial, R-CC-02); a missing account is `not_found`, a closed one `private`.
// `archives+month`: the archive list (as "YYYY/MM" keys) and one month's games (`month`, else the newest), cut to
// the newest LOOKUP_MONTH_GAMES_MAX games (the web shows the five most recent; the raw month can be megabytes).
import { LRUCache } from "lru-cache";
import { ChessComClient, compareMonthKeys } from "@repo/chess-import/chesscom/client";
import type { MonthKey } from "@repo/chess-import/chesscom/types";
import { isProviderError } from "@repo/chess-import/errors";
import type { FetchLike } from "@repo/chess-import/http";
import {
  InternalLookupData,
  PROVIDER_LOOKUP_GATE_WAIT_MS,
  type InternalLookupBody,
} from "@repo/contracts/internal/provider";
import { importMetric, type ImportMetricSink } from "../../import/metrics";
import type { Logger } from "../../obs/log";
import type { ProviderGates } from "../../providers/gate";
import type { Clock } from "../../scheduler/clock";

/** The worker's lookup cache (§7.7.2): 600 s, at most 2,000 answers. */
export const LOOKUP_CACHE_TTL_MS = 600_000;
export const LOOKUP_CACHE_MAX = 2_000;
/** `archives+month` returns at most this many of the month's newest games. */
export const LOOKUP_MONTH_GAMES_MAX = 100;
/** The contract caps `archives` at 400 entries: the newest are kept. */
export const LOOKUP_ARCHIVES_MAX = 400;
/** `rate_limited` without a known pause end (the cap ran out in the queue): ask again after this long. */
export const LOOKUP_BUSY_RETRY_SEC = 5;

export type LookupOutcome =
  | { status: 200; body: InternalLookupData }
  | { status: 502; body: { error: "upstream"; kind: "timeout" | "error" } };

export interface ProviderLookupDeps {
  gates: ProviderGates;
  settings: { chesscomBaseUrl: string; contact: string };
  clock: Clock;
  /** The provider transport (the fault table and the stopwatch wrap it in boot.ts). */
  fetch: FetchLike;
  log: Logger;
  sink: ImportMetricSink;
}

function cacheKey(body: InternalLookupBody): string {
  return `${body.what}|${body.username.toLowerCase()}|${body.month ?? ""}`;
}

export class ProviderLookup {
  private readonly client: ChessComClient;
  private readonly cache: LRUCache<string, InternalLookupData>;

  constructor(private readonly deps: ProviderLookupDeps) {
    this.client = new ChessComClient({
      baseUrl: deps.settings.chesscomBaseUrl,
      contact: deps.settings.contact,
      fetch: deps.fetch,
      clock: deps.clock,
      // The process's Chess.com gate: shared with the imports (one request in flight per provider).
      gate: deps.gates.chesscom,
      caller: "web",
    });
    this.cache = new LRUCache<string, InternalLookupData>({
      max: LOOKUP_CACHE_MAX,
      ttl: LOOKUP_CACHE_TTL_MS,
      perf: { now: () => deps.clock.now() },
    });
  }

  /** Answers one validated body. Never throws. */
  async lookup(body: InternalLookupBody): Promise<LookupOutcome> {
    const key = cacheKey(body);
    const cached = this.cache.get(key);
    if (cached) {
      importMetric(this.deps.sink, "lookup.cache_hit", 1, { what: body.what });
      importMetric(this.deps.sink, "import.lookup_source", 1, { source: "worker", result: cached.kind });
      return { status: 200, body: cached };
    }
    let data: InternalLookupData;
    try {
      data = body.what === "profile+stats" ? await this.profileAndStats(body.username) : await this.archivesAndMonth(body);
    } catch (error) {
      if (!isProviderError(error)) {
        this.deps.log.error("lookup failed", { error });
        return { status: 502, body: { error: "upstream", kind: "error" } };
      }
      switch (error.kind) {
        case "not_found":
          data = { kind: "not_found" };
          break;
        case "closed":
          data = { kind: "private" };
          break;
        case "rate_limited": {
          const pausedSec = Math.ceil((this.deps.gates.pauseUntil("chesscom") - this.deps.clock.now()) / 1000);
          const retryAfterSec = Math.min(3_600, Math.max(1, error.retryAfterSec ?? (pausedSec > 0 ? pausedSec : LOOKUP_BUSY_RETRY_SEC)));
          // A 429 from Chess.com itself (status set) paused the gate; a refused wait (no status) did not.
          if (error.status === 429) importMetric(this.deps.sink, "import.rate_limited", 1, { provider: "chesscom" });
          importMetric(this.deps.sink, "import.lookup_source", 1, { source: "worker", result: "rate_limited" });
          return { status: 200, body: { kind: "rate_limited", retryAfterSec } };
        }
        case "timeout":
          importMetric(this.deps.sink, "import.lookup_source", 1, { source: "worker", result: "timeout" });
          return { status: 502, body: { error: "upstream", kind: "timeout" } };
        default:
          this.deps.log.warn("lookup upstream error", { kind: error.kind, status: error.status });
          importMetric(this.deps.sink, "import.lookup_source", 1, { source: "worker", result: "error" });
          return { status: 502, body: { error: "upstream", kind: "error" } };
      }
    }
    const checked = InternalLookupData.safeParse(data);
    if (!checked.success) {
      this.deps.log.error("lookup answer does not match the contract", { what: body.what });
      return { status: 502, body: { error: "upstream", kind: "error" } };
    }
    this.cache.set(key, checked.data);
    importMetric(this.deps.sink, "import.lookup_source", 1, { source: "worker", result: checked.data.kind });
    return { status: 200, body: checked.data };
  }

  /** Entries in the cache (tests). */
  get size(): number {
    return this.cache.size;
  }

  private async profileAndStats(username: string): Promise<InternalLookupData> {
    const opts = { maxWaitMs: PROVIDER_LOOKUP_GATE_WAIT_MS };
    const profile = await this.client.getProfile(username, opts);
    const stats = await this.client.getStats(username, opts);
    return { kind: "found", profile, stats };
  }

  private async archivesAndMonth(body: InternalLookupBody): Promise<InternalLookupData> {
    const opts = { maxWaitMs: PROVIDER_LOOKUP_GATE_WAIT_MS };
    const archives = await this.client.getArchives(body.username, opts);
    // No validators are sent, so a 304 cannot happen; treat one as "no archive list".
    const months: MonthKey[] = archives.status === 200 ? [...archives.months].sort(compareMonthKeys) : [];
    const month = (body.month as MonthKey | undefined) ?? months.at(-1);
    let games: unknown[] = [];
    if (month) {
      const res = await this.client.getMonth(body.username, month, opts);
      // Chess.com lists a month's games oldest first: keep the newest.
      games = res.status === 200 ? res.games.slice(-LOOKUP_MONTH_GAMES_MAX) : [];
    }
    return {
      kind: "found",
      profile: null,
      archives: months.slice(-LOOKUP_ARCHIVES_MAX),
      month: { games },
    };
  }
}
