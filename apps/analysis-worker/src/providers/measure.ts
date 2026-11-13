// `import.upstream_ms{provider, endpoint, status}` (phase-04 plan §10.2): the provider transport with a stopwatch.
// Wraps the fetch the provider clients use (providers/index.ts `fetch`), outside the fault table, so injected
// faults are measured like real answers. The time is until the response headers (a Lichess stream: until it
// starts; its length is the run's reading time). Endpoints are a closed set derived from the path, never the
// username: Chess.com `profile`, `stats`, `archives`, `month`; Lichess `export`; anything else `other`.
import type { FetchLike } from "@repo/chess-import/http";
import { importMetric, type ImportMetricSink } from "../import/metrics";
import type { Clock } from "../scheduler/clock";
import type { Provider } from "./gate";

export type UpstreamEndpoint = "profile" | "stats" | "archives" | "month" | "export" | "other";

/** The endpoint of a provider URL (the path after the configured base). */
export function endpointOf(provider: Provider, path: string): UpstreamEndpoint {
  const p = path.split("?")[0]!.replace(/\/+$/, "");
  if (provider === "lichess") return /^\/api\/games\/user\/[^/]+$/.test(p) ? "export" : "other";
  if (/^\/pub\/player\/[^/]+$/.test(p)) return "profile";
  if (/^\/pub\/player\/[^/]+\/stats$/.test(p)) return "stats";
  if (/^\/pub\/player\/[^/]+\/games\/archives$/.test(p)) return "archives";
  if (/^\/pub\/player\/[^/]+\/games\/\d{4}\/\d{2}$/.test(p)) return "month";
  return "other";
}

/** The status attribute: the HTTP class, or `error` / `timeout` when no response came. */
function statusClass(status: number): string {
  return status === 304 ? "304" : status === 429 ? "429" : `${Math.floor(status / 100)}xx`;
}

export function measuredFetch(
  inner: FetchLike,
  bases: Readonly<Record<Provider, string>>,
  clock: Pick<Clock, "now">,
  sink: ImportMetricSink,
): FetchLike {
  return async (input, init) => {
    let provider: Provider | null = null;
    let path = "";
    for (const p of ["chesscom", "lichess"] as const) {
      if (input === bases[p] || input.startsWith(`${bases[p]}/`)) {
        provider = p;
        path = input.slice(bases[p].length);
      }
    }
    if (!provider) return inner(input, init);
    const endpoint = endpointOf(provider, path);
    const t0 = clock.now();
    try {
      const res = await inner(input, init);
      importMetric(sink, "import.upstream_ms", clock.now() - t0, { provider, endpoint, status: statusClass(res.status) });
      return res;
    } catch (error) {
      const aborted = init.signal?.aborted === true;
      importMetric(sink, "import.upstream_ms", clock.now() - t0, { provider, endpoint, status: aborted ? "timeout" : "error" });
      throw error;
    }
  };
}
