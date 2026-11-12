/**
 * The archive G1 `GET /api/me/games` (phase-03 plan §9.1, §9.3, §12.7 "Archive").
 *
 * 30 VUs over the perf seed's 2,000-row member (packages/db/seed/perf-archive.ts, given a Clerk login with
 * `--email <perf login>`): each iteration picks a random filter (results, time classes, "has moments"), reads page 1,
 * then follows `meta.nextCursor` up to 3 pages deep, and revisits pages it has seen with If-None-Match. Pass:
 *   server_total{name:games} p95 < 160 ms (Server-Timing `total`; abortOnFail)
 *   not_modified_rate (304 on repeat pages) ≥ 80 %
 *   games_errors = 0
 *
 * Env:
 *   WEB_APP_URL, CLERK_SECRET_KEY (sk_test_…), VERCEL_AUTOMATION_BYPASS_SECRET   as review-read.ts
 *   GAMES_CLERK_USER_IDS | GAMES_USER_EMAILS | GAMES_TOKENS   the perf login that owns the 2,000 games
 *   GAMES_VUS, GAMES_DURATION     override 30 / 5m (local smoke: GAMES_VUS=2 GAMES_DURATION=20s)
 *   RESULT_FILE                   default ../results/p03-games-list-local.json (CI / stage B: p03-games-list-<sha>.json)
 *
 *   cd perf/k6 && pnpm run build && CLERK_SECRET_KEY=sk_test_… GAMES_USER_EMAILS=<perf login> k6 run dist/games-list.js
 */
import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';
import type { Options } from 'k6/options';
import { bypassHeaders, closeSessions, currentToken, openSessions, serverTiming, type ClerkSetup } from '../lib/clerk-sessions';

declare const __ENV: Record<string, string | undefined>;

const BASE_URL = (__ENV.WEB_APP_URL || 'https://replay-chess-dev-replaychess007-1069.vercel.app').replace(/\/$/, '');
const VUS = Number(__ENV.GAMES_VUS || 30);
const DURATION = __ENV.GAMES_DURATION || '5m';
const RESULT_FILE = __ENV.RESULT_FILE || '../results/p03-games-list-local.json';
const MAX_DEPTH = 3;

/** CT/http/plain.ts GAME_RESULT_FILTERS / GAME_TC_FILTERS. */
const RESULTS = ['win', 'loss', 'draw'];
const TCS = ['bullet', 'blitz', 'rapid', 'classical'];

const serverTotal = new Trend('server_total', true);
const serverDb = new Trend('server_db', true);
const notModified = new Rate('not_modified_rate');
const errors = new Rate('games_errors');

export const options: Options = {
  scenarios: {
    browse: { executor: 'constant-vus', vus: VUS, duration: DURATION, exec: 'browse' },
  },
  thresholds: {
    'server_total{name:games}': [{ threshold: 'p(95)<160', abortOnFail: true, delayAbortEval: '30s' }],
    not_modified_rate: ['rate>=0.8'],
    games_errors: ['rate==0'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup(): ClerkSetup {
  const clerk = openSessions('GAMES', 1);
  const res = http.get(`${BASE_URL}/api/me/games`, { headers: { ...bypassHeaders(), Authorization: `Bearer ${currentToken(clerk)}` }, tags: { name: 'warmup' } });
  check(res, { 'warm-up 200': (r) => r.status === 200 });
  return clerk;
}

export function teardown(data: ClerkSetup): void {
  closeSessions(data);
}

function pick<T>(xs: readonly T[]): T[] {
  return xs.filter(() => Math.random() < 0.4);
}

/** A random filter: an empty one a third of the time (the default view is the most read). */
export function randomQuery(): string {
  if (Math.random() < 0.34) return '';
  const q: string[] = [];
  const result = pick(RESULTS);
  const tc = pick(TCS);
  if (result.length) q.push(`result=${result.join(',')}`);
  if (tc.length) q.push(`tc=${tc.join(',')}`);
  if (Math.random() < 0.3) q.push('moments=1');
  return q.join('&');
}

// Per-VU ETags by URL (repeat pages revalidate).
const etags: Record<string, string> = {};

function get(data: ClerkSetup, url: string) {
  const headers: Record<string, string> = { ...bypassHeaders(), Authorization: `Bearer ${currentToken(data)}`, Accept: 'application/json' };
  const repeat = Boolean(etags[url]);
  if (repeat) headers['If-None-Match'] = etags[url]!;
  const res = http.get(url, { headers, tags: { name: 'games' } });
  const timing = serverTiming(res.headers['Server-Timing']);
  if (timing.total !== undefined) serverTotal.add(timing.total, { name: 'games' });
  if (timing.db !== undefined) serverDb.add(timing.db, { name: 'games' });
  const ok = res.status === 200 || res.status === 304;
  errors.add(!ok);
  if (repeat) notModified.add(res.status === 304);
  const etag = res.headers['Etag'] || res.headers['ETag'];
  if (res.status === 200 && etag) etags[url] = String(etag);
  check(res, { 'games 200 or 304': () => ok });
  return res;
}

// Per-VU cursors by URL, so a 304 on a repeat page can still go one page deeper.
const nextOf: Record<string, string | null> = {};

export function browse(data: ClerkSetup): void {
  const query = randomQuery();
  let url = `${BASE_URL}/api/me/games${query ? `?${query}` : ''}`;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const res = get(data, url);
    if (res.status === 200) {
      const meta = (res.json() as { meta?: { nextCursor?: string | null } }).meta;
      nextOf[url] = meta?.nextCursor ?? null;
    }
    const next = nextOf[url];
    if (!next) break;
    url = `${BASE_URL}/api/me/games?${query ? `${query}&` : ''}cursor=${encodeURIComponent(next)}`;
    sleep(0.2 + Math.random() * 0.4);
  }
  sleep(0.5 + Math.random());
}

type Summary = { metrics: Record<string, { values?: Record<string, number> }> };

export function handleSummary(summary: Summary): Record<string, string> {
  const v = (metric: string, stat: string) => summary.metrics[metric]?.values?.[stat];
  const fmt = (n: number | undefined, unit = 'ms') => (n === undefined || Number.isNaN(n) ? 'n/a' : `${n.toFixed(1)}${unit}`);
  const text = [
    '',
    `GET /api/me/games against ${BASE_URL}`,
    `  server_total p95  ${fmt(v('server_total{name:games}', 'p(95)') ?? v('server_total', 'p(95)'))} (threshold 160ms)`,
    `  server_db p95     ${fmt(v('server_db', 'p(95)'))}`,
    `  client p95        ${fmt(v('http_req_duration{name:games}', 'p(95)') ?? v('http_req_duration', 'p(95)'))}`,
    `  304 on repeats    ${fmt((v('not_modified_rate', 'rate') ?? NaN) * 100, '%')} (threshold 80%)`,
    `  errors            ${fmt((v('games_errors', 'rate') ?? NaN) * 100, '%')} (threshold 0%)`,
    `  summary JSON      ${RESULT_FILE}`,
    '',
  ].join('\n');
  return { stdout: text, [RESULT_FILE]: JSON.stringify(summary, null, 2) };
}
