/**
 * ACC-7 `GET /api/import/status` under polling (phase-04 plan §9.7, §12.9; testing X18).
 *
 * `IMPORT_VUS` VUs (default 50) poll the import status of their member the way the fallback poll does (every 2–3 s,
 * `If-None-Match` with the last ETag). Pass:
 *   server_total{name:import_status} p95 < 100 ms (Server-Timing `total`; abortOnFail)
 *   not_modified_rate ≥ 95 % (the status rarely changes between polls)
 *   import_status_errors = 0
 *
 * Env:
 *   WEB_APP_URL, CLERK_SECRET_KEY (sk_test_…), VERCEL_AUTOMATION_BYPASS_SECRET     as games-list.ts
 *   IMPORT_CLERK_USER_IDS | IMPORT_USER_EMAILS | IMPORT_TOKENS   members with a linked account (e.g. pool users reset to
 *                                                                the `connected-both` persona: scripts/dev/personas.ts)
 *   IMPORT_VUS, IMPORT_DURATION      override 50 / 3m (local smoke: IMPORT_VUS=5 IMPORT_DURATION=20s)
 *   RESULT_FILE                      default ../results/p04-import-status-local.json (stage B: p04-import-status-<sha>.json)
 *
 *   cd perf/k6 && pnpm run build && CLERK_SECRET_KEY=sk_test_… IMPORT_USER_EMAILS=<pool logins> k6 run dist/import-status.js
 */
import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';
import type { Options } from 'k6/options';
import { bypassHeaders, closeSessions, currentToken, mint, openSessions, serverTiming, type ClerkSetup } from '../lib/clerk-sessions';

declare const __ENV: Record<string, string | undefined>;

const BASE_URL = (__ENV.WEB_APP_URL || 'https://replay-chess-dev-replaychess007-1069.vercel.app').replace(/\/$/, '');
const VUS = Number(__ENV.IMPORT_VUS || 50);
const DURATION = __ENV.IMPORT_DURATION || '3m';
const RESULT_FILE = __ENV.RESULT_FILE || '../results/p04-import-status-local.json';

const serverTotal = new Trend('server_total', true);
const notModified = new Rate('not_modified_rate');
const errors = new Rate('import_status_errors');

export const options: Options = {
  scenarios: { poll: { executor: 'constant-vus', vus: VUS, duration: DURATION, exec: 'poll' } },
  thresholds: {
    'server_total{name:import_status}': [{ threshold: 'p(95)<100', abortOnFail: true, delayAbortEval: '30s' }],
    not_modified_rate: ['rate>=0.95'],
    import_status_errors: ['rate==0'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup(): ClerkSetup {
  const clerk = openSessions('IMPORT', 20);
  // setup() runs outside any VU (__VU = 0), so it mints for the first user itself instead of currentToken().
  const warm = clerk.mode === 'tokens' ? clerk.tokens[0]! : mint(clerk.sessionIds[0]!);
  const res = http.get(`${BASE_URL}/api/import/status`, { headers: { ...bypassHeaders(), Authorization: `Bearer ${warm}` }, tags: { name: 'warmup' } });
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
  const res = http.get(`${BASE_URL}/api/import/status`, { headers, tags: { name: 'import_status' } });
  const timing = serverTiming(res.headers['Server-Timing']);
  if (timing.total !== undefined) serverTotal.add(timing.total, { name: 'import_status' });
  const ok = res.status === 200 || res.status === 304;
  errors.add(!ok);
  if (repeat) notModified.add(res.status === 304);
  const tag = res.headers['Etag'] || res.headers['ETag'];
  if (res.status === 200 && tag) etag = String(tag);
  check(res, { 'status 200 or 304': () => ok });
  sleep(2 + Math.random());
}

type Summary = { metrics: Record<string, { values?: Record<string, number> }> };

export function handleSummary(summary: Summary): Record<string, string> {
  const v = (metric: string, stat: string) => summary.metrics[metric]?.values?.[stat];
  const fmt = (n: number | undefined, unit = 'ms') => (n === undefined || Number.isNaN(n) ? 'n/a' : `${n.toFixed(1)}${unit}`);
  const text = [
    '',
    `GET /api/import/status against ${BASE_URL} (${VUS} VUs, ${DURATION})`,
    `  server_total p95  ${fmt(v('server_total{name:import_status}', 'p(95)') ?? v('server_total', 'p(95)'))} (threshold 100ms)`,
    `  client p95        ${fmt(v('http_req_duration{name:import_status}', 'p(95)') ?? v('http_req_duration', 'p(95)'))}`,
    `  304 on repeats    ${fmt((v('not_modified_rate', 'rate') ?? NaN) * 100, '%')} (threshold 95%)`,
    `  errors            ${fmt((v('import_status_errors', 'rate') ?? NaN) * 100, '%')} (threshold 0%)`,
    `  summary JSON      ${RESULT_FILE}`,
    '',
  ].join('\n');
  return { stdout: text, [RESULT_FILE]: JSON.stringify(summary, null, 2) };
}
