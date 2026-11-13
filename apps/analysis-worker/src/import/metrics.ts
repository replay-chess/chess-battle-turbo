// Import metrics (phase-04 plan §10.2 "Metrics", api-perf AP-15). Every value goes two ways at once:
//
//   - Sentry's metrics API through `Telemetry.metric()` (a no-op without SENTRY_DSN);
//   - an in-memory series in this process (`ImportMetrics`), served by the signed `GET /internal/metrics` under
//     `imports` (obs/metrics.ts), so a plan without Sentry metrics (feasibility §2.5 [V]) loses nothing: the weekly
//     ops report reads the same counters there.
//
// Names and attributes are a closed set (below): providers, triggers, endpoints, phases and reasons only, never a
// username, a ref or an id, so the series stay few and carry no PII.
import { z } from "zod";
import type { MetricKind, Telemetry } from "../obs/telemetry";

/** §10.2's worker-side metrics, with their kind and the attributes each one may carry. */
export const IMPORT_METRICS = {
  /** Games a run imported (new rows for this member), at the run's end. */
  "import.games": { kind: "count", attributes: ["provider", "trigger"] },
  /** Claim → finish of a run's successful attempt. */
  "import.duration_ms": { kind: "distribution", attributes: ["provider", "trigger"] },
  /** Claim → the first chunk statement committed (D4-28: the newest games are visible early). */
  "import.first_chunk_ms": { kind: "distribution", attributes: ["provider"] },
  /** How long a due import job waited for the I/O lane (claim − max(runAt, createdAt)). */
  "import.queue_wait_ms": { kind: "distribution", attributes: ["kind"] },
  /** One chunk statement (≤ 100 games) round trip. */
  "import.chunk_ms": { kind: "distribution", attributes: ["provider", "phase"] },
  /** One upstream call, until the response headers (a Lichess stream: until it starts). */
  "import.upstream_ms": { kind: "distribution", attributes: ["provider", "endpoint", "status"] },
  /** A 429 that paused a provider gate (import or lookup). */
  "import.rate_limited": { kind: "count", attributes: ["provider"] },
  /** Games a run skipped: `unsupported` (variant, unrated, too short, unparsable) or `taken` (the side is another member's). */
  "import.skipped": { kind: "count", attributes: ["reason"] },
  /** A Chess.com lookup the worker served for the web (D4-23: Vercel's IPs were limited). */
  "import.lookup_source": { kind: "count", attributes: ["source", "result"] },
  /** Backlog analyses released by a paying member's import (§8.9). */
  "import.backlog_released": { kind: "count", attributes: [] },
  /** A lookup answered from the worker's 600 s LRU. */
  "lookup.cache_hit": { kind: "count", attributes: ["what"] },
  /** Games an IMPORT_PURGE removed for one member (§8.12). */
  "import.purged_games": { kind: "count", attributes: ["provider"] },
  /** A run attempt that ended in failure (terminal or retrying). */
  "import.failed": { kind: "count", attributes: ["provider", "code", "terminal"] },
  /**
   * The first review of an INITIAL run is ready: its analysis committed − the run's `startedAt` (§9.1 SLO "first review
   * of the newest imported game ≤ 3 min", server truth AP-15; FIX-1).
   */
  "import.review_ready_ms": { kind: "distribution", attributes: ["provider"] },
} as const satisfies Record<string, { kind: MetricKind; attributes: readonly string[] }>;

export type ImportMetricName = keyof typeof IMPORT_METRICS;
type AttrName<N extends ImportMetricName> = (typeof IMPORT_METRICS)[N]["attributes"][number];
export type ImportMetricAttributes<N extends ImportMetricName> = { [K in AttrName<N>]: string | number | boolean };

/** Most series kept in memory (a closed set is far below it; a bug that opens it is capped, not unbounded). */
export const IMPORT_SERIES_MAX = 200;
/** Values kept per series for the p50. */
const WINDOW = 100;
const ATTR_VALUE = /^[a-z0-9_.:-]{1,40}$/;

export const ImportMetricSeries = z.object({
  name: z.string().max(40),
  attributes: z.record(z.string().max(20), z.union([z.string().max(40), z.number(), z.boolean()])),
  count: z.int().min(0),
  sum: z.number(),
  /** Median of the last 100 values (distributions); null for counts. */
  p50: z.number().nullable(),
});
export type ImportMetricSeries = z.infer<typeof ImportMetricSeries>;

export const ImportMetricsSnapshot = z.object({
  v: z.literal(1),
  series: z.array(ImportMetricSeries).max(IMPORT_SERIES_MAX),
  /** Series dropped because the cap was reached (should stay 0). */
  dropped: z.int().min(0),
});
export type ImportMetricsSnapshot = z.infer<typeof ImportMetricsSnapshot>;

interface Series {
  name: ImportMetricName;
  attributes: Record<string, string | number | boolean>;
  count: number;
  sum: number;
  window: number[];
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function cleanAttributes(attributes: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attributes)) {
    out[k] = typeof v === "string" && !ATTR_VALUE.test(v) ? "other" : v;
  }
  return out;
}

/** The in-memory import series of this process (one per name + attribute set). */
export class ImportMetrics {
  private readonly series = new Map<string, Series>();
  private dropped = 0;

  record<N extends ImportMetricName>(name: N, value: number, attributes: ImportMetricAttributes<N>): void {
    if (!Number.isFinite(value)) return;
    const attrs = cleanAttributes(attributes as Record<string, string | number | boolean>);
    const key = `${name}|${Object.keys(attrs)
      .sort()
      .map((k) => `${k}=${String(attrs[k])}`)
      .join(",")}`;
    let s = this.series.get(key);
    if (!s) {
      if (this.series.size >= IMPORT_SERIES_MAX) {
        this.dropped++;
        return;
      }
      s = { name, attributes: attrs, count: 0, sum: 0, window: [] };
      this.series.set(key, s);
    }
    s.count++;
    s.sum += value;
    if (IMPORT_METRICS[name].kind === "distribution") {
      s.window.push(value);
      if (s.window.length > WINDOW) s.window.shift();
    }
  }

  /** The sum of a name over every attribute set (tests, the bench). */
  total(name: ImportMetricName, where: Partial<Record<string, string | number | boolean>> = {}): number {
    let n = 0;
    for (const s of this.series.values()) {
      if (s.name !== name) continue;
      if (Object.entries(where).some(([k, v]) => s.attributes[k] !== v)) continue;
      n += s.sum;
    }
    return n;
  }

  /** How many values a name recorded (tests). */
  count(name: ImportMetricName): number {
    let n = 0;
    for (const s of this.series.values()) if (s.name === name) n += s.count;
    return n;
  }

  snapshot(): ImportMetricsSnapshot {
    return {
      v: 1,
      series: [...this.series.values()].map((s) => ({
        name: s.name,
        attributes: { ...s.attributes },
        count: s.count,
        sum: s.sum,
        p50: s.window.length > 0 ? median(s.window) : null,
      })),
      dropped: this.dropped,
    };
  }
}

/** Where a metric goes: the in-memory series (`Metrics.imports`) and Sentry. */
export interface ImportMetricSink {
  metrics: { imports: ImportMetrics };
  telemetry: Pick<Telemetry, "metric">;
}

/** Records one import metric both ways (Sentry + `/internal/metrics`). Never throws. */
export function importMetric<N extends ImportMetricName>(
  sink: ImportMetricSink,
  name: N,
  value: number,
  attributes: ImportMetricAttributes<N>,
): void {
  try {
    sink.metrics.imports.record(name, value, attributes);
    sink.telemetry.metric(IMPORT_METRICS[name].kind, name, value, attributes as Record<string, string | number | boolean>);
  } catch {
    // Metrics are best effort: never fail an import or a lookup over one.
  }
}
