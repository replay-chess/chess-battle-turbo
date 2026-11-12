/**
 * Waits until the dev PostHog project has an event (phase-03 plan §12.8 step 3, owner test T22): after a dev deploy,
 * the worker's real-engine smoke must reach PostHog as `analysis_ready` with `regrade: false` and
 * `ms_from_game_end: null` (smoke runs are excluded from the SLO data) within the window.
 *
 *   POSTHOG_PERSONAL_API_KEY=… POSTHOG_PROJECT_ID=… pnpm --filter web exec tsx scripts/qa/posthog-event-check.ts \
 *     --event analysis_ready --where "properties.regrade = false AND properties.ms_from_game_end IS NULL" \
 *     --since-minutes 30 --timeout-sec 180
 *
 * Reads only (HogQL `SELECT count()`); refuses an `app_env` other than dev. The key is never printed.
 * Exit 0 = found, 1 = not found within the timeout, 2 = configuration or API error.
 */
import { pathToFileURL } from "node:url";

export interface Args {
  event: string;
  where: string;
  sinceMinutes: number;
  timeoutSec: number;
  appEnv: string;
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { event: "", where: "", sinceMinutes: 30, timeoutSec: 180, appEnv: "dev" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--event") out.event = argv[++i] ?? "";
    else if (a === "--where") out.where = argv[++i] ?? "";
    else if (a === "--since-minutes") out.sinceMinutes = Number(argv[++i]);
    else if (a === "--timeout-sec") out.timeoutSec = Number(argv[++i]);
    else if (a === "--app-env") out.appEnv = argv[++i] ?? "";
    else throw new Error(`unknown argument ${a}`);
  }
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(out.event)) throw new Error("--event must be a snake_case event name");
  if (out.appEnv !== "dev") throw new Error("--app-env: only the dev project is checked by CI");
  if (/;|--/.test(out.where)) throw new Error("--where must be one HogQL condition");
  if (!(out.sinceMinutes > 0 && out.sinceMinutes <= 24 * 60)) throw new Error("--since-minutes must be 1..1440");
  if (!(out.timeoutSec > 0 && out.timeoutSec <= 900)) throw new Error("--timeout-sec must be 1..900");
  return out;
}

/** The HogQL count query (pure, for the unit test). */
export function hogql(a: Args): string {
  const extra = a.where ? ` AND (${a.where})` : "";
  return (
    `SELECT count() FROM events WHERE event = '${a.event}' AND properties.app_env = '${a.appEnv}'` +
    ` AND timestamp > now() - INTERVAL ${Math.round(a.sinceMinutes)} MINUTE${extra}`
  );
}

async function count(host: string, project: string, key: string, query: string): Promise<number> {
  const res = await fetch(`${host}/api/projects/${encodeURIComponent(project)}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`PostHog query answered ${res.status}`);
  const body = (await res.json()) as { results?: unknown[][] };
  return Number(body.results?.[0]?.[0] ?? 0);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  const project = process.env.POSTHOG_PROJECT_ID;
  const host = (process.env.POSTHOG_API_HOST || "https://us.posthog.com").replace(/\/+$/, "");
  if (!key || !project) {
    console.error("POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID (the dev project) are required");
    return 2;
  }
  const query = hogql(args);
  console.log(`waiting up to ${args.timeoutSec} s for: ${query}`);
  const until = Date.now() + args.timeoutSec * 1000;
  for (;;) {
    const n = await count(host, project, key, query);
    if (n > 0) {
      console.log(`found ${n} ${args.event} event(s)`);
      return 0;
    }
    if (Date.now() > until) {
      console.error(`no ${args.event} event within ${args.timeoutSec} s`);
      return 1;
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(2);
    },
  );
}
