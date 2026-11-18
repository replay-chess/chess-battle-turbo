/**
 * The Weakness Profile under load (phase-06 plan §9.5, §9.4; testing X18). Dev only (or a local stack): never
 * production; before a dev run check the replay-chess-dev usage page and skip above 60 % of any Hobby quota.
 *
 * Four scenarios, one after the other, over `WEAK_USERS` members whose profiles are READY (pool users reset to the
 * `weak-member` persona: real CC0 games graded by the dev worker; `cd apps/web && npx tsx scripts/dev/personas.ts
 * --reset <n> --persona weak-member`):
 *   cold              WEAK_VUS (20) VUs × GET /api/train/weakness                       p95 < 160 ms, errors < 0.5 %
 *   revalidate        the same with If-None-Match from each member's first response     ≥ 95 % 304, p95 < 80 ms
 *   recompute_burst   WEAK_BURST (50) POST /api/train/weakness/recompute from the members in 10 s: exactly one 202 per
 *                     member and 429 for the rest (the durable 1-per-600-s limit, AP-11; the Neon-suspend repeat of
 *                     §9.5 is a dev-run step: suspend the endpoint, then run with WEAK_ONLY=recompute_burst again)
 *   drill_start       WEAK_DRILL_RPS (5) rps of POST /api/train/sessions {kind: weakness} for WEAK_DRILL_DURATION (2m)
 *                                                                                    p95 < 250 ms
 * Pass: the thresholds below (abortOnFail on the hard SLOs). `server_total` (Server-Timing) is recorded per name.
 *
 * Env:
 *   WEB_APP_URL, CLERK_SECRET_KEY (sk_test_…), VERCEL_AUTOMATION_BYPASS_SECRET   as import-status.ts
 *   WEAK_CLERK_USER_IDS | WEAK_USER_EMAILS | WEAK_TOKENS   the members (≤ 20)
 *   WEAK_VUS, WEAK_COLD_ITERATIONS, WEAK_BURST, WEAK_DRILL_RPS, WEAK_DRILL_DURATION   overrides (local smoke:
 *                       WEAK_VUS=4 WEAK_COLD_ITERATIONS=80 WEAK_BURST=12 WEAK_DRILL_RPS=1 WEAK_DRILL_DURATION=20s)
 *   WEAK_ONLY           run one scenario (cold | revalidate | recompute_burst | drill_start)
 *   RESULT_FILE         default ../results/p06-weakness-local.json (CI/dev: p06-weakness-<sha>.json; perf/compare.ts
 *                       flags a regression > 15 % against the previous run)
 *
 *   cd perf/k6 && pnpm run build && CLERK_SECRET_KEY=sk_test_… WEAK_USER_EMAILS=<pool logins> k6 run dist/weakness.js
 */
import { check } from 'k6';
import http, { type RefinedResponse, type ResponseType } from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';
import type { Options, Scenario } from 'k6/options';
import { bypassHeaders, closeSessions, currentToken, mint, openSessions, serverTiming, type ClerkSetup } from '../lib/clerk-sessions';

declare const __ENV: Record<string, string | undefined>;
declare const __VU: number;
declare const __ITER: number;

const BASE_URL = (__ENV.WEB_APP_URL || 'https://replay-chess-dev-replaychess007-1069.vercel.app').replace(/\/$/, '');
const VUS = Number(__ENV.WEAK_VUS || 20);
const COLD_ITERATIONS = Number(__ENV.WEAK_COLD_ITERATIONS || 400);
const BURST = Number(__ENV.WEAK_BURST || 50);
const DRILL_RPS = Number(__ENV.WEAK_DRILL_RPS || 5);
const DRILL_DURATION = __ENV.WEAK_DRILL_DURATION || '2m';
const ONLY = __ENV.WEAK_ONLY || '';
const RESULT_FILE = __ENV.RESULT_FILE || '../results/p06-weakness-local.json';

const serverTotal = new Trend('server_total', true);
const errors = new Rate('weakness_errors');
const revalidated = new Rate('revalidate_304');
const burstAccepted = new Counter('burst_202');
const burstLimited = new Counter('burst_429');
const burstOther = new Counter('burst_other');

const SCENARIOS: Record<string, Scenario> = {
  cold: { executor: 'shared-iterations', vus: VUS, iterations: COLD_ITERATIONS, exec: 'cold', maxDuration: '3m' },
  revalidate: { executor: 'shared-iterations', vus: VUS, iterations: COLD_ITERATIONS, exec: 'revalidate', startTime: '3m', maxDuration: '3m' },
  recompute_burst: { executor: 'shared-iterations', vus: Math.min(10, BURST), iterations: BURST, exec: 'burst', startTime: '6m', maxDuration: '10s' },
  drill_start: {
    executor: 'constant-arrival-rate',
    rate: DRILL_RPS,
    timeUnit: '1s',
    duration: DRILL_DURATION,
    preAllocatedVUs: Math.max(2, DRILL_RPS * 2),
    exec: 'drill',
    startTime: '6m20s',
  },
};

function selected(): Record<string, Scenario> {
  if (!ONLY) return SCENARIOS;
  const s = SCENARIOS[ONLY];
  if (!s) throw new Error(`WEAK_ONLY=${ONLY}: one of ${Object.keys(SCENARIOS).join(', ')}`);
  return { [ONLY]: { ...s, startTime: '0s' } };
}

export const options: Options = {
  scenarios: selected(),
  thresholds: {
    'http_req_duration{name:tr5_cold}': [{ threshold: 'p(95)<160', abortOnFail: true }],
    'http_req_duration{name:tr5_revalidate}': ['p(95)<80'],
    'http_req_duration{name:drill_start}': ['p(95)<250'],
    revalidate_304: ['rate>=0.95'],
    weakness_errors: [{ threshold: 'rate<0.005', abortOnFail: true }],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

/** A UUID v4 (TR-7's Idempotency-Key must be one). */
function uuid(): string {
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) s += h[Math.floor(Math.random() * 16)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-${h[8 + Math.floor(Math.random() * 4)]}${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

type Data = { clerk: ClerkSetup; patterns: (string | null)[]; etags: (string | null)[] };

function headers(data: Data, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${currentToken(data.clerk)}`, accept: 'application/json', ...bypassHeaders(), ...extra };
}

function tokenOf(data: Data, member: number): string {
  return data.clerk.mode === 'tokens' ? data.clerk.tokens[member % data.clerk.tokens.length]! : mint(data.clerk.sessionIds[member % data.clerk.sessionIds.length]!);
}

function record(res: RefinedResponse<ResponseType>): void {
  const st = serverTiming(res.headers['Server-Timing'] || res.headers['server-timing']);
  if (st.total !== undefined) serverTotal.add(st.total);
}

/** Each member's top matchable pattern (for drill_start) and ETag (for revalidate), read once. */
export function setup(): Data {
  const clerk = openSessions('WEAK', 20);
  const n = clerk.mode === 'tokens' ? clerk.tokens.length : clerk.sessionIds.length;
  const patterns: (string | null)[] = [];
  const etags: (string | null)[] = [];
  for (let i = 0; i < n; i++) {
    const res = http.get(`${BASE_URL}/api/train/weakness`, { headers: { Authorization: `Bearer ${tokenOfSetup(clerk, i)}`, accept: 'application/json', ...bypassHeaders() } });
    if (res.status !== 200) throw new Error(`member ${i}: TR-5 ${res.status} (reset the pool users to weak-member first)`);
    const body = res.json() as { data: { status: string; top: { pattern: string; matchable: boolean }[] } };
    if (body.data.status !== 'ready') throw new Error(`member ${i}: profile ${body.data.status}, not ready`);
    patterns.push(body.data.top.find((r) => r.matchable)?.pattern ?? null);
    etags.push((res.headers.Etag || res.headers.ETag || res.headers.etag) ?? null);
  }
  return { clerk, patterns, etags };
}

function tokenOfSetup(clerk: ClerkSetup, i: number): string {
  return clerk.mode === 'tokens' ? clerk.tokens[i]! : mint(clerk.sessionIds[i]!);
}

export function teardown(data: Data): void {
  closeSessions(data.clerk);
}

export function cold(data: Data): void {
  const res = http.get(`${BASE_URL}/api/train/weakness`, { headers: headers(data), tags: { name: 'tr5_cold' } });
  record(res);
  errors.add(!check(res, { 'TR-5 200': (r) => r.status === 200 }));
}

export function revalidate(data: Data): void {
  const member = (__VU - 1) % data.etags.length;
  const etag = data.etags[member];
  const res = http.get(`${BASE_URL}/api/train/weakness`, {
    headers: { ...headers(data), Authorization: `Bearer ${tokenOf(data, member)}`, ...(etag ? { 'If-None-Match': etag } : {}) },
    tags: { name: 'tr5_revalidate' },
  });
  record(res);
  revalidated.add(res.status === 304);
  errors.add(!check(res, { 'TR-5 200 or 304': (r) => r.status === 304 || r.status === 200 }));
}

export function burst(data: Data): void {
  const member = __ITER % data.patterns.length;
  const res = http.post(`${BASE_URL}/api/train/weakness/recompute`, '{}', {
    headers: { ...headers(data), Authorization: `Bearer ${tokenOf(data, member)}`, 'content-type': 'application/json' },
    tags: { name: 'recompute' },
  });
  if (res.status === 202) burstAccepted.add(1);
  else if (res.status === 429) burstLimited.add(1);
  else burstOther.add(1);
  errors.add(!check(res, { 'TR-12 202 or 429': (r) => r.status === 202 || r.status === 429 }));
}

export function drill(data: Data): void {
  const member = __ITER % data.patterns.length;
  const pattern = data.patterns[member];
  if (!pattern) return;
  const res = http.post(
    `${BASE_URL}/api/train/sessions`,
    JSON.stringify({ kind: 'weakness', pattern, size: 10, mix: true }),
    {
      headers: { ...headers(data), Authorization: `Bearer ${tokenOf(data, member)}`, 'content-type': 'application/json', 'Idempotency-Key': uuid() },
      tags: { name: 'drill_start' },
    },
  );
  record(res);
  errors.add(!check(res, { 'TR-7 weakness 200/201': (r) => r.status === 200 || r.status === 201 }));
}

type Summary = { metrics: Record<string, { values?: Record<string, number> }> };

export function handleSummary(summary: Summary): Record<string, string> {
  const v = (metric: string, stat: string) => summary.metrics[metric]?.values?.[stat];
  const fmt = (n: number | undefined, unit = 'ms') => (n === undefined || Number.isNaN(n) ? 'n/a' : `${n.toFixed(1)}${unit}`);
  const text = [
    '',
    `Weakness Profile against ${BASE_URL}${ONLY ? ` (only ${ONLY})` : ''}`,
    `  TR-5 cold p95          ${fmt(v('http_req_duration{name:tr5_cold}', 'p(95)'))} (threshold 160ms)`,
    `  TR-5 304 p95           ${fmt(v('http_req_duration{name:tr5_revalidate}', 'p(95)'))} (threshold 80ms)`,
    `  304 share              ${fmt((v('revalidate_304', 'rate') ?? NaN) * 100, '%')} (threshold ≥ 95%)`,
    `  TR-12 burst            202 × ${v('burst_202', 'count') ?? 0}, 429 × ${v('burst_429', 'count') ?? 0}, other × ${v('burst_other', 'count') ?? 0} (one 202 per member)`,
    `  TR-7 weakness p95      ${fmt(v('http_req_duration{name:drill_start}', 'p(95)'))} (threshold 250ms)`,
    `  errors                 ${fmt((v('weakness_errors', 'rate') ?? NaN) * 100, '%')} (threshold < 0.5%)`,
    `  summary JSON           ${RESULT_FILE}`,
    '',
  ].join('\n');
  return { stdout: text, [RESULT_FILE]: JSON.stringify(summary, null, 2) };
}
