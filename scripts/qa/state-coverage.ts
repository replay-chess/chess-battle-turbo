/**
 * Design-state coverage (phase-01 plan §12.3, CT X8).
 *
 * Compares the states in docs/qa/design-states.json (boards of phases ≤
 * docs/qa/phase.txt) with the Playwright tags the specs carry:
 *   @state:<Board>.<value>   reached with real data on a real route
 *   @demo:<Board>.<value>    reached on a demo route (/dev/ui/…)
 * For a board with several enum props, `<Board>.<prop>=<value>` names one
 * exactly; `<Board>.<value>` works when the value is unambiguous. A board with
 * no enum prop has the one state "default" (`@demo:<Board>` also counts).
 *
 * docs/qa/design-states.overrides.json holds the reviewed exceptions:
 *   ignore    { "<Board>" | "<Board>.<prop>" | "<Board>.<value>": reason }  not a state
 *   demoOnly  { "<Board>.<value>": reason }                                  demo is enough
 *   deferred  { "<Board>.<value>": { phase, reason } }                       the state ships in a later
 *             phase than its board; it is not counted while phase.txt < phase, and is due (missing
 *             unless tagged) from that phase on, so the entry can stay until someone tags it.
 *
 * A state with no tag is MISSING; a state reached only by a demo route without
 * a demoOnly reason is UNEXPLAINED. Either fails (exit 1).
 *
 *   pnpm exec tsx scripts/qa/state-coverage.ts [--phase N] [--only-phase N]
 *     [--from-json report.json ...] [--require-run] [--markdown <file>] [--json <file>]
 *
 * Without --from-json it runs `playwright test --list --reporter=json` for both
 * configs in apps/web (playwright.config.ts and playwright.devices.config.ts).
 * A listing only proves the tags exist: a skipped test still counts. For the
 * sign-off, pass the json reporter output of real runs (CI writes
 * apps/web/test-results/results.json) with --require-run: then a state counts
 * only through a test that passed.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DesignStates } from "./extract-design-states";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(ROOT, "apps/web");

export type Deferral = { phase: number; reason: string };
export type Overrides = {
  ignore?: Record<string, string>;
  demoOnly?: Record<string, string>;
  deferred?: Record<string, Deferral>;
};
export type StateRow = {
  board: string;
  phase: number;
  key: string;
  status: "real" | "demo" | "demo-unexplained" | "missing" | "ignored" | "deferred";
  reason?: string;
};

/**
 * Every `@state:` / `@demo:` tag in a Playwright JSON report.
 *
 * - A `--list` report has no results: every tagged test counts ("tagged", `ran: false`).
 * - A run report (the json reporter after `playwright test`): a tag counts only through a test that passed
 *   (`expected` or `flaky`), so a skipped or failing test reaches nothing (`ran: true`).
 * Tags in describe titles apply to the tests inside them.
 */
export function tagsFromReport(report: unknown): { state: Set<string>; demo: Set<string>; ran: boolean } {
  const state = new Set<string>();
  const demo = new Set<string>();
  let ran = false;
  type Test = { status?: string; results?: unknown[] };
  type Node = { title?: string; tags?: string[]; suites?: unknown[]; specs?: unknown[]; tests?: Test[] };
  const textOf = (n: Node) => [n.title ?? "", ...(n.tags ?? []).map((t) => (t.startsWith("@") ? t : `@${t}`))].join(" ");
  const specs: { text: string; tests: Test[] }[] = [];
  const walk = (node: unknown, inherited: string) => {
    if (!node || typeof node !== "object") return;
    const n = node as Node;
    const text = `${inherited} ${textOf(n)}`;
    if (Array.isArray(n.tests)) {
      specs.push({ text, tests: n.tests });
      if (n.tests.some((t) => (t.results?.length ?? 0) > 0)) ran = true;
    }
    for (const s of n.suites ?? []) walk(s, text);
    for (const s of n.specs ?? []) walk(s, text);
  };
  walk(report, "");
  for (const spec of specs) {
    const reached = !ran || spec.tests.some((t) => t.status === "expected" || t.status === "flaky");
    if (!reached) continue;
    for (const m of spec.text.matchAll(/@(state|demo):([A-Za-z0-9_.=-]+)/g)) {
      (m[1] === "state" ? state : demo).add(m[2]!.replace(/\.$/, ""));
    }
  }
  return { state, demo, ran };
}

/** The tag keys that reach one state of a board. */
export function keysFor(board: string, prop: string, value: string, props: Record<string, string[]>): string[] {
  const keys = [`${board}.${prop}=${value}`];
  const owners = Object.entries(props).filter(([, opts]) => opts.includes(value));
  if (owners.length === 1) keys.push(`${board}.${value}`);
  if (value === "default" && Object.keys(props).length === 1) keys.push(board);
  return keys;
}

export function computeCoverage(
  manifest: DesignStates,
  tags: { state: Set<string>; demo: Set<string> },
  overrides: Overrides,
  maxPhase: number,
  onlyPhase?: number,
): StateRow[] {
  const rows: StateRow[] = [];
  const ignore = overrides.ignore ?? {};
  const demoOnly = overrides.demoOnly ?? {};
  const deferred = overrides.deferred ?? {};
  for (const b of manifest.boards) {
    if (b.phase > maxPhase || (onlyPhase !== undefined && b.phase !== onlyPhase)) continue;
    for (const [prop, values] of Object.entries(b.props)) {
      for (const value of values) {
        const keys = keysFor(b.board, prop, value, b.props);
        const label = keys[keys.length - 1] === b.board ? `${b.board}.default` : keys.at(-1)!;
        const ignoredBy = [b.board, `${b.board}.${prop}`, ...keys].find((k) => k in ignore);
        if (ignoredBy) {
          rows.push({ board: b.board, phase: b.phase, key: label, status: "ignored", reason: ignore[ignoredBy] });
          continue;
        }
        if (keys.some((k) => tags.state.has(k))) {
          rows.push({ board: b.board, phase: b.phase, key: label, status: "real" });
        } else if (keys.some((k) => tags.demo.has(k))) {
          const why = keys.map((k) => demoOnly[k]).find(Boolean);
          rows.push({ board: b.board, phase: b.phase, key: label, status: why ? "demo" : "demo-unexplained", reason: why });
        } else {
          const later = keys.map((k) => deferred[k]).find((d) => d && d.phase > maxPhase);
          rows.push(
            later
              ? { board: b.board, phase: b.phase, key: label, status: "deferred", reason: `P${later.phase}: ${later.reason}` }
              : { board: b.board, phase: b.phase, key: label, status: "missing" },
          );
        }
      }
    }
  }
  return rows;
}

function deferredList(r: StateRow[]): string {
  const d = r.filter((x) => x.status === "deferred");
  return d.map((x) => `${x.key.replace(`${x.board}.`, "")} (${x.reason?.split(":")[0]})`).join(", ") || "—";
}

export function toMarkdown(rows: StateRow[]): string {
  const boards = [...new Set(rows.map((r) => r.board))];
  const lines = [
    "| Board | Phase | Real data | Demo only | Missing | Deferred | Ignored |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const board of boards) {
    const r = rows.filter((x) => x.board === board);
    const list = (s: StateRow["status"][]) =>
      r.filter((x) => s.includes(x.status)).map((x) => x.key.replace(`${board}.`, "") + (x.status === "demo-unexplained" ? " (no reason)" : "")).join(", ") || "—";
    lines.push(`| ${board} | P${r[0]!.phase} | ${list(["real"])} | ${list(["demo", "demo-unexplained"])} | ${list(["missing"])} | ${deferredList(r)} | ${list(["ignored"])} |`);
  }
  const count = (s: StateRow["status"]) => rows.filter((x) => x.status === s).length;
  lines.push(
    "",
    `Real ${count("real")} · demo ${count("demo")} · demo without reason ${count("demo-unexplained")} · missing ${count("missing")} · deferred ${count("deferred")} · ignored ${count("ignored")}`,
  );
  return lines.join("\n");
}

function listJson(configArgs: string[]): unknown {
  // The JSON goes to a file: config-time logs (dotenv, warnings) share stdout.
  const file = path.join(mkdtempSync(path.join(tmpdir(), "state-coverage-")), "list.json");
  execFileSync("pnpm", ["exec", "playwright", "test", ...configArgs, "--list", "--reporter=json"], {
    cwd: WEB,
    env: { ...process.env, FORCE_COLOR: "0", PLAYWRIGHT_JSON_OUTPUT_NAME: file },
    stdio: ["ignore", "ignore", "inherit"],
  });
  return JSON.parse(readFileSync(file, "utf8"));
}

function main() {
  const args = process.argv.slice(2);
  const all = (name: string) => args.flatMap((a, i) => (a === name ? [args[i + 1]!] : []));
  const one = (name: string) => all(name)[0];

  const manifest = JSON.parse(readFileSync(path.join(ROOT, "docs/qa/design-states.json"), "utf8")) as DesignStates;
  const overridesFile = path.join(ROOT, "docs/qa/design-states.overrides.json");
  const overrides = existsSync(overridesFile) ? (JSON.parse(readFileSync(overridesFile, "utf8")) as Overrides) : {};
  const phase = Number(one("--phase") ?? readFileSync(path.join(ROOT, "docs/qa/phase.txt"), "utf8").trim());
  const onlyPhase = one("--only-phase") ? Number(one("--only-phase")) : undefined;

  const reports = all("--from-json").length
    ? all("--from-json").map((f) => JSON.parse(readFileSync(f, "utf8")))
    : [listJson([]), listJson(["-c", "playwright.devices.config.ts"])];
  const tags = { state: new Set<string>(), demo: new Set<string>() };
  let listings = 0;
  for (const r of reports) {
    const t = tagsFromReport(r);
    if (!t.ran) listings++;
    t.state.forEach((x) => tags.state.add(x));
    t.demo.forEach((x) => tags.demo.add(x));
  }
  const mode =
    listings === reports.length
      ? "tagged (from `playwright test --list`: a skipped or failing test still counts; pass --from-json <results.json> of a run to count only passing tests)"
      : listings
        ? `mixed: ${reports.length - listings} run report(s) count passing tests only, ${listings} listing(s) count every tagged test`
        : "reached (run reports: only passing tests count)";
  console.log(`state-coverage mode: ${mode}\n`);
  if (args.includes("--require-run") && listings) {
    console.error("state-coverage: --require-run needs run reports (json reporter output), not --list output");
    process.exit(1);
  }

  const rows = computeCoverage(manifest, tags, overrides, phase, onlyPhase);
  const md = toMarkdown(rows);
  console.log(md);
  const mdOut = one("--markdown");
  if (mdOut) appendFileSync(mdOut, `## Design-state coverage (phase ≤ ${phase})\n\nMode: ${mode}\n\n${md}\n`);
  const jsonOut = one("--json");
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 2));

  const missing = rows.filter((r) => r.status === "missing");
  const unexplained = rows.filter((r) => r.status === "demo-unexplained");
  if (missing.length || unexplained.length) {
    console.error(
      `\nstate-coverage: ${missing.length} missing, ${unexplained.length} demo-only without a reason in design-states.overrides.json`,
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
