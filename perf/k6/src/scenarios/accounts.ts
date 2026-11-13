/**
 * ACC-1 `GET /api/accounts` (phase-04 plan §9.1, §9.7 `perf/k6/accounts.js`; testing X18): /settings/connected's read.
 *
 * `ACCOUNTS_VUS` VUs (default 30) open the page's read the way the screen does (a fresh read, then revalidations with
 * `If-None-Match` every 3–5 s while the page is open). Pass:
 *   server_total{name:accounts} p95 < 150 ms (Server-Timing `total`; abortOnFail)
 *   not_modified_rate ≥ 90 %
 *   accounts_errors = 0
 *
 * Env:
 *   WEB_APP_URL, CLERK_SECRET_KEY (sk_test_…), VERCEL_AUTOMATION_BYPASS_SECRET     as games-list.ts
 *   ACCOUNTS_CLERK_USER_IDS | ACCOUNTS_USER_EMAILS | ACCOUNTS_TOKENS   users with linked accounts (pool users reset to
 *                                                                      `connected-both`: scripts/dev/personas.ts)
 *   ACCOUNTS_VUS, ACCOUNTS_DURATION  override 30 / 3m (local smoke: ACCOUNTS_VUS=5 ACCOUNTS_DURATION=20s)
 *   RESULT_FILE                      default ../results/p04-accounts-local.json (stage B: p04-accounts-<sha>.json)
 *
 *   cd perf/k6 && pnpm run build && CLERK_SECRET_KEY=sk_test_… ACCOUNTS_USER_EMAILS=<pool logins> k6 run dist/accounts.js
 */
import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';
import type { Options } from 'k6/options';
import { bypassHeaders, closeSessions, currentToken, mint, openSessions, serverTiming, type ClerkSetup } from '../lib/clerk-sessions';

declare const __ENV: Record<string, string | undefined>;

const BASE_URL = (__ENV.WEB_APP_URL || 'https://replay-chess-dev-replaychess007-1069.vercel.app').replace(/\/$/, '');
const VUS = Number(__ENV.ACCOUNTS_VUS || 30);
const DURATION = __ENV.ACCOUNTS_DURATION || '3m';
const RESULT_FILE = __ENV.RESULT_FILE || '../results/p04-accounts-local.json';

const serverTotal = new Trend('server_total', true);
const notModified = new Rate('not_modified_rate');
const errors = new Rate('accounts_errors');

export const options: Options = {
  scenarios: { poll: { executor: 'constant-vus', vus: VUS, duration: DURATION, exec: 'poll' } },
  thresholds: {
    'server_total{name:accounts}': [{ threshold: 'p(95)<150', abortOnFail: true, delayAbortEval: '30s' }],
    not_modified_rate: ['rate>=0.9'],
    accounts_errors: ['rate==0'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup(): ClerkSetup {
  const clerk = openSessions('ACCOUNTS', 20);
  // setup() runs outside any VU (__VU = 0), so it mints for the first user itself instead of currentToken().
  const warm = clerk.mode === 'tokens' ? clerk.tokens[0]! : mint(clerk.sessionIds[0]!);
  const res = http.get(`${BASE_URL}/api/accounts`, { headers: { ...bypassHeaders(), Authorization: `Bearer ${warm}` }, tags: { name: 'warmup' } });
  check(res, { 'warm-up 200': (r) => r.status === 200 });
  return clerk;
}

export function teardown(data: ClerkSetup): void {
  closeSessions(data);
}

let etag = '';

export function poll(data: ClerkSetup): void {
  const headers: Record<string, string> = { ...bypassHeaders(), Authorization: `Bearer ${currentToken(data)}`, Accept: 'application/json' };
  const repeat = etag !== '';
  if (repeat) headers['If-None-Match'] = etag;
  const res = http.get(`${BASE_URL}/api/accounts`, { headers, tags: { name: 'accounts' } });
  const timing = serverTiming(res.headers['Server-Timing']);
  if (timing.total !== undefined) serverTotal.add(timing.total, { name: 'accounts' });
  const ok = res.status === 200 || res.status === 304;
  errors.add(!ok);
  if (repeat) notModified.add(res.status === 304);
  const tag = res.headers['Etag'] || res.headers['ETag'];
  if (res.status === 200 && tag) etag = String(tag);
  check(res, { 'status 200 or 304': () => ok });
  sleep(3 + 2 * Math.random());
}

type Summary = { metrics: Record<string, { values?: Record<string, number> }> };

export function handleSummary(summary: Summary): Record<string, string> {
  const v = (metric: string, stat: string) => summary.metrics[metric]?.values?.[stat];
  const fmt = (n: number | undefined, unit = 'ms') => (n === undefined || Number.isNaN(n) ? 'n/a' : `${n.toFixed(1)}${unit}`);
  const text = [
    '',
    `GET /api/accounts against ${BASE_URL} (${VUS} VUs, ${DURATION})`,
    `  server_total p95  ${fmt(v('server_total{name:accounts}', 'p(95)') ?? v('server_total', 'p(95)'))} (threshold 150ms)`,
    `  client p95        ${fmt(v('http_req_duration{name:accounts}', 'p(95)') ?? v('http_req_duration', 'p(95)'))}`,
    `  304 on repeats    ${fmt((v('not_modified_rate', 'rate') ?? NaN) * 100, '%')} (threshold 90%)`,
    `  errors            ${fmt((v('accounts_errors', 'rate') ?? NaN) * 100, '%')} (threshold 0%)`,
    `  summary JSON      ${RESULT_FILE}`,
    '',
  ].join('\n');
  return { stdout: text, [RESULT_FILE]: JSON.stringify(summary, null, 2) };
}
