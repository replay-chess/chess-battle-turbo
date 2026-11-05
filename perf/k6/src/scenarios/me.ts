/**
 * GET /api/me — the viewer bootstrap (phase-01 plan §9.1, §9.7, §12.8; 1B·F7).
 *
 * Two stages against the dev deployment (never production):
 *   cold         20 VUs × 2 min, plain GETs.           http_req_duration{name:me} p95 < 150 ms (abortOnFail)
 *   conditional  20 VUs × 1 min, If-None-Match sent.   304 rate > 95 % (the private-etag tier, CA AP-21)
 * plus checks > 99 %, and the server's own split from Server-Timing (API responses carry it outside
 * production): server_total and server_db trends.
 *
 * Auth: /api/me needs a Clerk session (the perf bypass identity does not apply: route() auth "user" needs a
 * Clerk JWT before the viewer loads, F4a open issue 4). Clerk session tokens live 60 s, so they are minted
 * during the run through the Clerk Backend API of the DEVELOPMENT instance:
 *   setup()     resolves the users (ME_CLERK_USER_IDS, else ME_USER_EMAILS looked up by email) and creates one
 *               session per user (POST /v1/sessions, development instances only);
 *   each VU     mints a session JWT (POST /v1/sessions/{id}/tokens) and re-mints it every 45 s;
 *   teardown()  revokes the sessions.
 * Or pass ME_TOKENS (comma-separated, fresh JWTs) for a run shorter than a token's life.
 *
 * Env:
 *   WEB_APP_URL                       default: the replay-chess-dev URL
 *   CLERK_SECRET_KEY                  the Clerk development instance's secret key (sk_test_…)
 *   ME_CLERK_USER_IDS | ME_USER_EMAILS  comma-separated; up to one user per VU is enough (VUs share users)
 *   VERCEL_AUTOMATION_BYPASS_SECRET   when the dev deployment is protected (Q-16)
 *   RESULT_FILE                       JSON summary path (default ../results/p01-me-local.json, i.e. perf/results/
 *                                     when run from perf/k6); CI names it p01-me-<sha>.json for perf/compare.ts
 *   ME_VUS, ME_COLD, ME_CONDITIONAL   override 20 / 2m / 1m for a quick local try
 *
 * Usage:
 *   cd perf/k6 && pnpm run build
 *   CLERK_SECRET_KEY=sk_test_… ME_USER_EMAILS=a@example.com,b@example.com k6 run dist/me.js
 */

import { check, fail, sleep } from 'k6';
import http from 'k6/http';
import { Options } from 'k6/options';
import { Rate, Trend } from 'k6/metrics';

declare const __ENV: Record<string, string | undefined>;
declare const __VU: number;

const BASE_URL = (__ENV.WEB_APP_URL || 'https://replay-chess-dev-replaychess007-1069.vercel.app').replace(/\/$/, '');
const CLERK_API = 'https://api.clerk.com/v1';
const CLERK_SECRET_KEY = __ENV.CLERK_SECRET_KEY || '';
const VUS = Number(__ENV.ME_VUS || 20);
const COLD = __ENV.ME_COLD || '2m';
const CONDITIONAL = __ENV.ME_CONDITIONAL || '1m';
const TOKEN_REFRESH_MS = 45_000;
const RESULT_FILE = __ENV.RESULT_FILE || '../results/p01-me-local.json';

const serverTotal = new Trend('server_total', true);
const serverDb = new Trend('server_db', true);
const notModified = new Rate('not_modified_rate');

/** Seconds of the cold stage, so the conditional stage starts right after it. */
function seconds(d: string): number {
  const m = /^(\d+)(s|m)$/.exec(d);
  if (!m) throw new Error(`duration must look like 90s or 2m, got ${d}`);
  return Number(m[1]) * (m[2] === 'm' ? 60 : 1);
}

export const options: Options = {
  scenarios: {
    cold: {
      executor: 'constant-vus',
      vus: VUS,
      duration: COLD,
      exec: 'cold',
      tags: { stage: 'cold' },
    },
    conditional: {
      executor: 'constant-vus',
      vus: VUS,
      duration: CONDITIONAL,
      startTime: `${seconds(COLD) + 5}s`,
      exec: 'conditional',
      tags: { stage: 'conditional' },
    },
  },
  thresholds: {
    'http_req_duration{name:me}': [{ threshold: 'p(95)<150', abortOnFail: true, delayAbortEval: '20s' }],
    checks: ['rate>0.99'],
    not_modified_rate: ['rate>0.95'],
  },
  // Clerk Backend API calls are tagged name:clerk and stay out of the me thresholds.
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

type SetupData = { mode: 'tokens'; tokens: string[] } | { mode: 'sessions'; sessionIds: string[] };

function clerkHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' };
}

function list(name: string): string[] {
  return (__ENV[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function bypassHeaders(): Record<string, string> {
  const secret = __ENV.VERCEL_AUTOMATION_BYPASS_SECRET;
  return secret ? { 'x-vercel-protection-bypass': secret } : {};
}

export function setup(): SetupData {
  const tokens = list('ME_TOKENS');
  if (tokens.length) return { mode: 'tokens', tokens };

  if (!CLERK_SECRET_KEY.startsWith('sk_test_')) {
    fail('Set CLERK_SECRET_KEY to the Clerk DEVELOPMENT secret key (sk_test_…), or pass ME_TOKENS');
  }
  let userIds = list('ME_CLERK_USER_IDS');
  if (!userIds.length) {
    for (const email of list('ME_USER_EMAILS')) {
      const res = http.get(`${CLERK_API}/users?email_address=${encodeURIComponent(email)}`, {
        headers: clerkHeaders(),
        tags: { name: 'clerk' },
      });
      const found = res.status === 200 ? (res.json() as Array<{ id: string }>) : [];
      if (found.length) userIds.push(found[0]!.id);
      else console.warn(`[me] no Clerk user for one of ME_USER_EMAILS (status ${res.status})`);
    }
  }
  userIds = userIds.slice(0, VUS);
  if (!userIds.length) fail('No users: set ME_CLERK_USER_IDS or ME_USER_EMAILS');

  const sessionIds: string[] = [];
  for (const userId of userIds) {
    const res = http.post(`${CLERK_API}/sessions`, JSON.stringify({ user_id: userId }), {
      headers: clerkHeaders(),
      tags: { name: 'clerk' },
    });
    if (res.status !== 200) fail(`Clerk POST /v1/sessions answered ${res.status} (development instances only)`);
    sessionIds.push((res.json() as { id: string }).id);
  }
  // Warm up: one request per user, so first-time provisioning (if any) is not measured.
  for (const sessionId of sessionIds) {
    http.get(`${BASE_URL}/api/me`, { headers: { ...bypassHeaders(), Authorization: `Bearer ${mint(sessionId)}` }, tags: { name: 'warmup' } });
  }
  console.log(`[me] ${sessionIds.length} Clerk session(s) against ${BASE_URL}`);
  return { mode: 'sessions', sessionIds };
}

export function teardown(data: SetupData): void {
  if (data.mode !== 'sessions') return;
  for (const id of data.sessionIds) {
    http.post(`${CLERK_API}/sessions/${id}/revoke`, null, { headers: clerkHeaders(), tags: { name: 'clerk' } });
  }
}

function mint(sessionId: string): string {
  const res = http.post(`${CLERK_API}/sessions/${sessionId}/tokens`, '{}', {
    headers: clerkHeaders(),
    tags: { name: 'clerk' },
  });
  if (res.status !== 200) fail(`Clerk session token answered ${res.status}`);
  return (res.json() as { jwt: string }).jwt;
}

// Per-VU state (each VU is its own JS runtime).
let token = '';
let tokenAt = 0;
let etag = '';

function currentToken(data: SetupData): string {
  if (data.mode === 'tokens') return data.tokens[(__VU - 1) % data.tokens.length]!;
  if (!token || Date.now() - tokenAt > TOKEN_REFRESH_MS) {
    token = mint(data.sessionIds[(__VU - 1) % data.sessionIds.length]!);
    tokenAt = Date.now();
  }
  return token;
}

/** `auth;dur=1.2, db;dur=3.4, total;dur=10.1` → { auth: 1.2, db: 3.4, total: 10.1 } */
function serverTiming(header: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (header || '').split(',')) {
    const m = /^\s*([a-z0-9_-]+)\s*;\s*dur=([\d.]+)/i.exec(part);
    if (m) out[m[1]!] = Number(m[2]);
  }
  return out;
}

function getMe(data: SetupData, ifNoneMatch?: string) {
  const headers: Record<string, string> = { ...bypassHeaders(), Authorization: `Bearer ${currentToken(data)}` };
  if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch;
  const res = http.get(`${BASE_URL}/api/me`, { headers, tags: { name: 'me' } });
  const timing = serverTiming(res.headers['Server-Timing']);
  if (timing.total !== undefined) serverTotal.add(timing.total);
  if (timing.db !== undefined) serverDb.add(timing.db);
  return res;
}

export function cold(data: SetupData): void {
  const res = getMe(data);
  check(res, {
    'me 200': (r) => r.status === 200,
    'me has an ETag': (r) => Boolean(r.headers['Etag'] || r.headers['ETag']),
    'me is private': (r) => /private/.test(String(r.headers['Cache-Control'] || '')),
  });
  sleep(0.5 + Math.random());
}

export function conditional(data: SetupData): void {
  if (!etag) {
    const first = getMe(data);
    etag = String(first.headers['Etag'] || first.headers['ETag'] || '');
    check(first, { 'me 200 (conditional stage, first)': (r) => r.status === 200 && etag !== '' });
    sleep(0.5);
    return;
  }
  const res = getMe(data, etag);
  notModified.add(res.status === 304);
  if (res.status === 200) etag = String(res.headers['Etag'] || res.headers['ETag'] || etag);
  check(res, { 'me 304 or 200': (r) => r.status === 304 || r.status === 200 });
  sleep(0.5 + Math.random());
}

type Summary = { metrics: Record<string, { values?: Record<string, number> }> };

export function handleSummary(summary: Summary): Record<string, string> {
  const v = (metric: string, stat: string) => summary.metrics[metric]?.values?.[stat];
  const fmt = (n: number | undefined, unit = 'ms') => (n === undefined ? 'n/a' : `${n.toFixed(1)}${unit}`);
  const text = [
    '',
    `GET /api/me against ${BASE_URL}`,
    `  me p95            ${fmt(v('http_req_duration{name:me}', 'p(95)') ?? v('http_req_duration', 'p(95)'))} (threshold 150ms)`,
    `  server_total p95  ${fmt(v('server_total', 'p(95)'))}`,
    `  server_db p95     ${fmt(v('server_db', 'p(95)'))}`,
    `  304 rate          ${fmt((v('not_modified_rate', 'rate') ?? NaN) * 100, '%')} (threshold 95%)`,
    `  checks            ${fmt((v('checks', 'rate') ?? NaN) * 100, '%')}`,
    `  summary JSON      ${RESULT_FILE}`,
    '',
  ].join('\n');
  return { stdout: text, [RESULT_FILE]: JSON.stringify(summary, null, 2) };
}
