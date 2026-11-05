/**
 * k6 results as data (phase-01 plan §12.8, §12.9; CT X18).
 *
 * Each phase commits its k6 summaries as perf/results/p<NN>-<scenario>-<sha>.json
 * (`k6 run --summary-export=…`, or a handleSummary JSON). This compares the
 * newest result of the current phase with the newest of an earlier phase for
 * the shared scenarios and fails on a regression above 15 %.
 *
 *   pnpm exec tsx perf/compare.ts [--phase 1] [--threshold 0.15] [--scenario me ...]
 *   pnpm exec tsx perf/compare.ts --current a.json --baseline b.json
 *
 * Exit 0 = no regression (or nothing to compare yet); 1 = regression; 2 = usage.
 * k6 runs only against dev, never production.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RESULTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "results");
export const SHARED_SCENARIOS = ["me", "api-read-mix", "ws-ramp", "train-session"];
/** Metrics compared (lower is better) and the statistic read from each. */
export const METRICS: Array<{ metric: string; stat: string }> = [
  { metric: "http_req_duration", stat: "p(95)" },
  { metric: "http_req_duration", stat: "p(99)" },
  { metric: "http_req_failed", stat: "rate" },
  { metric: "ws_connecting", stat: "p(95)" },
  { metric: "iteration_duration", stat: "p(95)" },
];

export type ResultFile = { file: string; phase: number; scenario: string; sha: string };

export function parseName(file: string): ResultFile | null {
  const m = /^p(\d{2})-([a-z0-9-]+)-([0-9a-f]{7,40})\.json$/.exec(path.basename(file));
  return m ? { file, phase: Number(m[1]), scenario: m[2]!, sha: m[3]! } : null;
}

/** Reads a statistic from either summary format (summary-export or handleSummary). */
export function readStat(summary: unknown, metric: string, stat: string): number | null {
  const m = (summary as { metrics?: Record<string, Record<string, unknown>> })?.metrics?.[metric];
  if (!m) return null;
  const values = (m.values as Record<string, unknown> | undefined) ?? m;
  const key = stat === "rate" && !("rate" in values) ? "value" : stat;
  const v = values[key];
  return typeof v === "number" ? v : null;
}

export type Comparison = { metric: string; baseline: number; current: number; change: number; regression: boolean };

export function compare(current: unknown, baseline: unknown, threshold = 0.15): Comparison[] {
  const out: Comparison[] = [];
  for (const { metric, stat } of METRICS) {
    const c = readStat(current, metric, stat);
    const b = readStat(baseline, metric, stat);
    if (c === null || b === null) continue;
    // Error rates start near 0: compare them in absolute points (1 point = 0.01).
    const change = stat === "rate" ? c - b : b === 0 ? (c === 0 ? 0 : Infinity) : (c - b) / b;
    const regression = stat === "rate" ? change > 0.01 : change > threshold;
    out.push({ metric: `${metric} ${stat}`, baseline: b, current: c, change, regression });
  }
  return out;
}

/** When a result file was committed (falls back to its mtime for uncommitted files). */
function committedAt(file: string): number {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%ct", "--", file], { encoding: "utf8" }).trim();
    if (out) return Number(out) * 1000;
  } catch {
    // not a git checkout
  }
  return statSync(file).mtimeMs;
}

/** The SHA in the name does not order runs, so the newest is the last one committed. */
function newest(files: ResultFile[]): ResultFile | undefined {
  return [...files].sort((a, b) => committedAt(a.file) - committedAt(b.file)).at(-1);
}

function fmt(c: Comparison): string {
  const pct = c.metric.endsWith("rate") ? `${(c.change * 100).toFixed(2)} pts` : `${(c.change * 100).toFixed(1)} %`;
  return `${c.regression ? "REGRESSION" : "ok        "}  ${c.metric.padEnd(26)} ${c.baseline.toFixed(2)} → ${c.current.toFixed(2)}  (${pct})`;
}

function main() {
  const args = process.argv.slice(2);
  const arg = (n: string) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const threshold = Number(arg("--threshold") ?? 0.15);
  const load = (f: string) => JSON.parse(readFileSync(f, "utf8"));
  let failed = false;

  if (arg("--current") || arg("--baseline")) {
    if (!arg("--current") || !arg("--baseline")) {
      console.error("--current and --baseline go together");
      process.exit(2);
    }
    for (const c of compare(load(arg("--current")!), load(arg("--baseline")!), threshold)) {
      console.log(fmt(c));
      failed ||= c.regression;
    }
    process.exit(failed ? 1 : 0);
  }

  const files = readdirSync(RESULTS).map((f) => parseName(path.join(RESULTS, f))).filter((f): f is ResultFile => f !== null);
  const phase = Number(arg("--phase") ?? Math.max(0, ...files.map((f) => f.phase)));
  const scenarios = args.flatMap((a, i) => (a === "--scenario" ? [args[i + 1]!] : []));
  for (const scenario of scenarios.length ? scenarios : SHARED_SCENARIOS) {
    const current = newest(files.filter((f) => f.scenario === scenario && f.phase === phase));
    const earlier = files.filter((f) => f.scenario === scenario && f.phase < phase);
    const lastPhase = Math.max(-1, ...earlier.map((f) => f.phase));
    const baseline = newest(earlier.filter((f) => f.phase === lastPhase));
    if (!current || !baseline) {
      console.log(`${scenario}: nothing to compare (current ${current ? path.basename(current.file) : "none"}, baseline ${baseline ? path.basename(baseline.file) : "none"})`);
      continue;
    }
    console.log(`${scenario}: ${path.basename(baseline.file)} → ${path.basename(current.file)}`);
    for (const c of compare(load(current.file), load(baseline.file), threshold)) {
      console.log(`  ${fmt(c)}`);
      failed ||= c.regression;
    }
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
