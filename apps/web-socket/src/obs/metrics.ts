// Socket server metrics (phase-02 plan 10.2): counters and samples are aggregated in memory and pushed to Sentry
// every 60 s (counters as sums, samples as p50/p99/max gauges), together with the process gauges: event-loop lag,
// sockets, games by phase, outbox depth and oldest unflushed change, RSS. No timer here touches the database.
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import type { MetricTags, Metrics } from "../ports";

// ── Event-loop lag ──────────────────────────────────────────────────────────────────────────────────────────────
export interface LoopLag {
  /** Lag of the last probe tick (ms): what `/health` checks (< 1 s). */
  current(): number;
  /** Percentiles (ms) since the last `reset()`. */
  p50(): number;
  p99(): number;
  reset(): void;
  stop(): void;
}

/**
 * `monitorEventLoopDelay` for the percentiles plus a 500 ms probe for the current lag (a stall shows up at the next
 * probe tick and clears one tick after it ends, so `/health` does not stay red for a whole push window).
 */
export function createLoopLag(probeEveryMs = 500): LoopLag {
  // The histogram records the full interval between its samples, so the sampling resolution is subtracted below.
  const resolutionMs = 20;
  let histogram: IntervalHistogram | null = null;
  try {
    histogram = monitorEventLoopDelay({ resolution: resolutionMs });
    histogram.enable();
  } catch {
    histogram = null;
  }
  let last = 0;
  let expected = Date.now() + probeEveryMs;
  const probe = setInterval(() => {
    const t = Date.now();
    last = Math.max(0, t - expected);
    expected = t + probeEveryMs;
  }, probeEveryMs);
  probe.unref();
  const pct = (p: number) =>
    histogram && histogram.count > 0 ? Math.max(0, histogram.percentile(p) / 1e6 - resolutionMs) : 0;
  return {
    current: () => last,
    p50: () => Math.round(pct(50) * 100) / 100,
    p99: () => Math.round(pct(99) * 100) / 100,
    reset: () => histogram?.reset(),
    stop() {
      clearInterval(probe);
      histogram?.disable();
    },
  };
}

/** A fixed lag source (tests). */
export function staticLoopLag(ms = 0): LoopLag {
  return { current: () => ms, p50: () => ms, p99: () => ms, reset() {}, stop() {} };
}

// ── Aggregation ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface MetricsSink {
  count(name: string, value: number, tags: Record<string, string>): void;
  gauge(name: string, value: number, tags: Record<string, string>, unit?: string): void;
}

/** Keeps at most this many samples per series between two pushes (newest kept). */
const MAX_SAMPLES = 2_000;

interface Series {
  name: string;
  tags: Record<string, string>;
}

function tagsKey(name: string, tags?: MetricTags): { key: string; series: Series } {
  const entries = tags ? Object.entries(tags).sort(([a], [b]) => a.localeCompare(b)) : [];
  const str: Record<string, string> = {};
  for (const [k, v] of entries) str[k] = String(v);
  const key = entries.length ? `${name}{${entries.map(([k, v]) => `${k}=${String(v)}`).join(",")}}` : name;
  return { key, series: { name, tags: str } };
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

export interface AggregatedSnapshot {
  counts: { name: string; tags: Record<string, string>; value: number }[];
  samples: { name: string; tags: Record<string, string>; n: number; p50: number; p99: number; max: number }[];
}

/** The production `Metrics`: in-memory aggregation, drained by the 60 s push. */
export class AggregatingMetrics implements Metrics {
  private counts = new Map<string, { series: Series; value: number }>();
  private samples = new Map<string, { series: Series; values: number[] }>();

  count(name: string, tags?: MetricTags, value = 1): void {
    const { key, series } = tagsKey(name, tags);
    const entry = this.counts.get(key);
    if (entry) entry.value += value;
    else this.counts.set(key, { series, value });
  }

  sample(name: string, value: number, tags?: MetricTags): void {
    if (!Number.isFinite(value)) return;
    const { key, series } = tagsKey(name, tags);
    let entry = this.samples.get(key);
    if (!entry) {
      entry = { series, values: [] };
      this.samples.set(key, entry);
    }
    entry.values.push(value);
    if (entry.values.length > MAX_SAMPLES) entry.values.splice(0, entry.values.length - MAX_SAMPLES);
  }

  /** Returns everything since the last drain and starts a new window. */
  drain(): AggregatedSnapshot {
    const counts = [...this.counts.values()].map((c) => ({ name: c.series.name, tags: c.series.tags, value: c.value }));
    const samples = [...this.samples.values()].map((s) => {
      const sorted = [...s.values].sort((a, b) => a - b);
      return {
        name: s.series.name,
        tags: s.series.tags,
        n: sorted.length,
        p50: percentile(sorted, 50),
        p99: percentile(sorted, 99),
        max: sorted[sorted.length - 1] ?? 0,
      };
    });
    this.counts = new Map();
    this.samples = new Map();
    return { counts, samples };
  }
}

export interface ProcessGauges {
  sockets: number;
  gamesByPhase: Record<string, number>;
  outboxDepth: number;
  outboxOldestMs: number;
}

export interface MetricsPushOptions {
  metrics: AggregatingMetrics;
  sink: MetricsSink;
  loopLag: LoopLag;
  gauges(): ProcessGauges;
  everyMs?: number;
  base?: Record<string, string>;
}

/** Pushes the aggregated window every 60 s (plan 10.2). Returns `stop` and `pushNow` (drain). */
export function startMetricsPush(options: MetricsPushOptions): { stop(): void; pushNow(): void } {
  const base = options.base ?? {};
  const pushNow = () => {
    const { sink, loopLag } = options;
    const snap = options.metrics.drain();
    for (const c of snap.counts) sink.count(c.name, c.value, { ...base, ...c.tags });
    for (const s of snap.samples) {
      const tags = { ...base, ...s.tags };
      sink.gauge(`${s.name}.p50`, s.p50, tags);
      sink.gauge(`${s.name}.p99`, s.p99, tags);
      sink.gauge(`${s.name}.max`, s.max, tags);
      sink.count(`${s.name}.n`, s.n, tags);
    }
    const g = options.gauges();
    sink.gauge("ws.loop_lag_ms.p50", loopLag.p50(), base, "millisecond");
    sink.gauge("ws.loop_lag_ms.p99", loopLag.p99(), base, "millisecond");
    loopLag.reset();
    sink.gauge("ws.sockets", g.sockets, base);
    for (const [phase, n] of Object.entries(g.gamesByPhase)) sink.gauge("ws.games", n, { ...base, phase });
    sink.gauge("ws.outbox.depth", g.outboxDepth, base);
    sink.gauge("ws.outbox.oldest_ms", g.outboxOldestMs, base, "millisecond");
    sink.gauge("ws.rss_mb", Math.round(process.memoryUsage().rss / 1048576), base, "megabyte");
  };
  const handle = setInterval(pushNow, options.everyMs ?? 60_000);
  handle.unref();
  return { stop: () => clearInterval(handle), pushNow };
}

/** Fans one `Metrics` call out to several (production aggregation + a test spy). */
export function teeMetrics(...targets: Metrics[]): Metrics {
  return {
    count: (name, tags, value) => targets.forEach((t) => t.count(name, tags, value)),
    sample: (name, value, tags) => targets.forEach((t) => t.sample(name, value, tags)),
  };
}
