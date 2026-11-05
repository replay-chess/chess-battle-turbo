/**
 * Error window (phase-01 plan §10.2, §12.9, §15; CT X6.7).
 *
 * Prints, for the test window that starts at the last dev deploy, the new
 * Sentry issues per project for `environment:dev`, and the Vercel runtime
 * errors (5xx and error-level logs) of the latest dev deployment. Its output
 * is pasted into docs/qa/phase-NN-signoff.md; DoD: no new issue, or each one
 * triaged there.
 *
 *   pnpm exec tsx scripts/qa/error-window.ts --since 2026-11-05T10:00:00Z [--env dev] [--fail-on-new] [--json out.json]
 *
 * Env (read-scope tokens only; values are never printed):
 *   SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECTS (comma list, e.g. "replay-web,replay-socket")
 *   VERCEL_TOKEN, VERCEL_PROJECT (default replay-chess-dev), VERCEL_TEAM_ID (optional)
 * A source without its token is reported as "skipped", never as clean.
 * [V] The Vercel runtime-logs endpoint and its fields need confirming on first use.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type SentryIssue = {
  id: string;
  shortId: string;
  title: string;
  culprit?: string;
  count: string;
  userCount?: number;
  firstSeen: string;
  lastSeen: string;
  level: string;
  permalink: string;
  project?: { slug: string };
};

type Section = { source: string; status: "ok" | "skipped" | "error"; items: string[]; note?: string };

async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${new URL(url).host}${new URL(url).pathname}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function sentrySection(since: Date, environment: string): Promise<Section[]> {
  const token = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG;
  const projects = (process.env.SENTRY_PROJECTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!token || !org || !projects.length) {
    return [{ source: "sentry", status: "skipped", items: [], note: "SENTRY_AUTH_TOKEN, SENTRY_ORG or SENTRY_PROJECTS not set" }];
  }
  const sections: Section[] = [];
  for (const project of projects) {
    try {
      const { id } = await getJson<{ id: string }>(`https://sentry.io/api/0/projects/${org}/${project}/`, token);
      const qs = new URLSearchParams({
        project: id,
        environment,
        query: `firstSeen:>=${since.toISOString()}`,
        statsPeriod: "14d",
        sort: "date",
        limit: "100",
      });
      const issues = await getJson<SentryIssue[]>(`https://sentry.io/api/0/organizations/${org}/issues/?${qs}`, token);
      sections.push({
        source: `sentry:${project}`,
        status: "ok",
        items: issues.map(
          (i) => `${i.shortId} [${i.level}] ${i.title} — ${i.count} events, first ${i.firstSeen}, ${i.permalink}`,
        ),
      });
    } catch (err) {
      sections.push({ source: `sentry:${project}`, status: "error", items: [], note: (err as Error).message });
    }
  }
  return sections;
}

type VercelLog = { level?: string; message?: string; statusCode?: number; responseStatusCode?: number; timestampInMs?: number; requestPath?: string; path?: string };

export async function vercelSection(since: Date): Promise<Section> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { source: "vercel", status: "skipped", items: [], note: "VERCEL_TOKEN not set" };
  const project = process.env.VERCEL_PROJECT ?? "replay-chess-dev";
  const team = process.env.VERCEL_TEAM_ID ? `&teamId=${process.env.VERCEL_TEAM_ID}` : "";
  try {
    const { deployments } = await getJson<{ deployments: Array<{ uid: string; url: string; created: number }> }>(
      `https://api.vercel.com/v6/deployments?app=${encodeURIComponent(project)}&target=production&state=READY&limit=1${team}`,
      token,
    );
    const dep = deployments[0];
    if (!dep) return { source: "vercel", status: "error", items: [], note: `no READY deployment of ${project}` };
    const res = await fetch(
      `https://api.vercel.com/v1/projects/${encodeURIComponent(project)}/deployments/${dep.uid}/runtime-logs?since=${since.getTime()}${team}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) throw new Error(`runtime-logs: HTTP ${res.status}`);
    const text = await res.text();
    const logs: VercelLog[] = text
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as VercelLog];
        } catch {
          return [];
        }
      });
    const errors = logs.filter((l) => {
      const status = l.responseStatusCode ?? l.statusCode ?? 0;
      const t = l.timestampInMs ?? Date.now();
      return t >= since.getTime() && (status >= 500 || l.level === "error" || l.level === "fatal");
    });
    // Group by path + status so a burst reads as one line.
    const groups = new Map<string, number>();
    for (const e of errors) {
      const key = `${e.responseStatusCode ?? e.statusCode ?? "-"} ${e.requestPath ?? e.path ?? "?"} ${(e.message ?? "").slice(0, 80)}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    return {
      source: `vercel:${project} (${dep.url})`,
      status: "ok",
      items: [...groups].map(([k, n]) => `${n}× ${k}`),
    };
  } catch (err) {
    return { source: "vercel", status: "error", items: [], note: (err as Error).message };
  }
}

export function render(since: Date, sections: Section[]): string {
  const lines = [`### Error window since ${since.toISOString()}`, ""];
  for (const s of sections) {
    const head = s.status === "ok" ? `${s.items.length} new` : s.status.toUpperCase();
    lines.push(`**${s.source}**: ${head}${s.note ? ` (${s.note})` : ""}`);
    for (const item of s.items) lines.push(`- ${item}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (n: string) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const sinceArg = arg("--since");
  const since = sinceArg ? new Date(sinceArg) : new Date(Date.now() - 24 * 3_600_000);
  if (Number.isNaN(since.getTime())) {
    console.error("--since must be an ISO time, e.g. 2026-11-05T10:00:00Z");
    process.exit(2);
  }
  const sections = [...(await sentrySection(since, arg("--env") ?? "dev")), await vercelSection(since)];
  console.log(render(since, sections));
  const out = arg("--json");
  if (out) writeFileSync(out, JSON.stringify({ since: since.toISOString(), sections }, null, 2));
  const hours = (Date.now() - since.getTime()) / 3_600_000;
  if (hours < 24) console.warn(`note: the window is ${hours.toFixed(1)} h; the sign-off needs at least 24 h`);
  if (args.includes("--fail-on-new") && sections.some((s) => s.items.length > 0 || s.status === "error")) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
