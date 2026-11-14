/**
 * The member read mix (phase-05 plan §12.6, §9.6 "R1 class"; testing X18). No earlier phase committed this scenario
 * (perf/compare.ts lists it as shared), so P5 creates it with its own rows and the reads the app shell makes anyway.
 *
 * `MIX_RATE` requests per second (default 30, a constant arrival rate) for `MIX_DURATION` (3m), each one of:
 *   GET /api/me             40 %   (P1 viewer, ETag)
 *   GET /api/train/today    15 %   (P5 R1)
 *   GET /api/home           10 %   (P5 HOME-1)
 *   GET /api/me/badges      10 %   (P5 R8)
 *   GET /api/train/bank     10 %   (P5 R2, page 1)
 *   GET /api/import/status  15 %   (P4 ACC-7)
 * Pass: server_total (Server-Timing `total`) p95 < 100 ms for train_today and home (R1 server) and < 160 ms for the bank
 * (R2), http_req_duration p95 < 250 ms end to end for the R1-class reads and < 400 ms for the bank, read_errors = 0.
 *
 * Env:
 *   WEB_APP_URL, CLERK_SECRET_KEY (sk_test_…), VERCEL_AUTOMATION_BYPASS_SECRET   as import-status.ts
 *   MIX_CLERK_USER_IDS | MIX_USER_EMAILS | MIX_TOKENS   members (pool users reset to `bank-member`)
 *   MIX_RATE, MIX_DURATION, MIX_VUS                     override 30 / 3m / 60 preallocated VUs
 *                                                       (local smoke: MIX_RATE=5 MIX_DURATION=30s MIX_VUS=10)
 *   RESULT_FILE                                         default ../results/p05-api-read-mix-local.json
 *
 *   cd perf/k6 && pnpm run build && CLERK_SECRET_KEY=sk_test_… MIX_USER_EMAILS=<pool logins> k6 run dist/api-read-mix.js
 */
import { check } from 'k6';
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';
import type { Options } from 'k6/options';
import { bypassHeaders, closeSessions, currentToken, mint, openSessions, serverTiming, type ClerkSetup } from '../lib/clerk-sessions';

declare const __ENV: Record<string, string | undefined>;

const BASE_URL = (__ENV.WEB_APP_URL || 'https://replay-chess-dev-replaychess007-1069.vercel.app').replace(/\/$/, '');
const RATE = Number(__ENV.MIX_RATE || 30);
const DURATION = __ENV.MIX_DURATION || '3m';
const PREALLOCATED = Number(__ENV.MIX_VUS || 60);
const RESULT_FILE = __ENV.RESULT_FILE || '../results/p05-api-read-mix-local.json';

/** [name, path, share]: the shares sum to 1. */
const MIX: readonly (readonly [string, string, number])[] = [
  ['me', '/api/me', 0.4],
  ['train_today', '/api/train/today', 0.15],
  ['home', '/api/home', 0.1],
  ['badges', '/api/me/badges', 0.1],
  ['train_bank', '/api/train/bank', 0.1],
  ['import_status', '/api/import/status', 0.15],
];

const serverTotal = new Trend('server_total', true);
const errors = new Rate('read_errors');

export const options: Options = {
  scenarios: {
    mix: { executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: DURATION, preAllocatedVUs: PREALLOCATED, exec: 'read' },
  },
  thresholds: {
    'server_total{name:train_today}': ['p(95)<100'],
    'server_total{name:home}': ['p(95)<100'],
    'http_req_duration{name:train_today}': ['p(95)<250'],
    'http_req_duration{name:home}': ['p(95)<250'],
    // The other reads of the mix (R1 class 250 ms end to end; R2's bank page 400 ms): per-name rows in the summary too.
    'http_req_duration{name:me}': ['p(95)<250'],
    'http_req_duration{name:badges}': ['p(95)<250'],
    'http_req_duration{name:import_status}': ['p(95)<250'],
    'http_req_duration{name:train_bank}': ['p(95)<400'],
    'server_total{name:train_bank}': ['p(95)<160'],
    read_errors: ['rate==0'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup(): ClerkSetup {
  const clerk = openSessions('MIX', 20);
  const warm = clerk.mode === 'tokens' ? clerk.tokens[0]! : mint(clerk.sessionIds[0]!);
  for (const [, path] of MIX) {
    const res = http.get(`${BASE_URL}${path}`, { headers: { ...bypassHeaders(), Authorization: `Bearer ${warm}` }, tags: { name: 'warmup' } });
    check(res, { 'warm-up 200': (r) => r.status === 200 });
  }
  return clerk;
}

export function teardown(data: ClerkSetup): void {
  closeSessions(data);
}

function pick(): readonly [string, string, number] {
  let r = Math.random();
  for (const row of MIX) {
    r -= row[2];
    if (r <= 0) return row;
  }
  return MIX[MIX.length - 1]!;
}

export function read(data: ClerkSetup): void {
  const [name, path] = pick();
  const res = http.get(`${BASE_URL}${path}`, {
    headers: { ...bypassHeaders(), Authorization: `Bearer ${currentToken(data)}`, Accept: 'application/json' },
    tags: { name },
  });
  const t = serverTiming(res.headers['Server-Timing']);
  if (t.total !== undefined) serverTotal.add(t.total, { name });
  const ok = res.status === 200 || res.status === 304;
  errors.add(!ok);
  check(res, { 'status 200 or 304': () => ok });
}

type Summary = { metrics: Record<string, { values?: Record<string, number> }> };

export function handleSummary(summary: Summary): Record<string, string> {
  const v = (metric: string, stat: string) => summary.metrics[metric]?.values?.[stat];
  const fmt = (n: number | undefined, unit = 'ms') => (n === undefined || Number.isNaN(n) ? 'n/a' : `${n.toFixed(1)}${unit}`);
  const rows = MIX.map(([name]) => `  ${name.padEnd(14)} p95 ${fmt(v(`http_req_duration{name:${name}}`, 'p(95)'))} client · ${fmt(v(`server_total{name:${name}}`, 'p(95)'))} server`);
  const text = [
    '',
    `Member read mix against ${BASE_URL} (${RATE}/s, ${DURATION})`,
    ...rows,
    `  errors          ${fmt((v('read_errors', 'rate') ?? NaN) * 100, '%')} (threshold 0%)`,
    `  summary JSON    ${RESULT_FILE}`,
    '',
  ].join('\n');
  return { stdout: text, [RESULT_FILE]: JSON.stringify(summary, null, 2) };
}
