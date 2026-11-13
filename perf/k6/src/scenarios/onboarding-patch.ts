/**
 * OB-1 `PATCH /api/me/onboarding` (phase-04 plan §9.1, §9.7 `perf/k6/onboarding-patch.js`; testing X18).
 *
 * Each VU is one user at the Plan step (pool users reset to the `onboarding-plan` persona) saving its goals and minutes
 * again, as the Goals step does on Continue: `{step: "plan", goals, dailyMinutes, timeZone}` (monotonic: the step
 * stays at Plan, the choices are rewritten), one PATCH every 1.2–1.8 s (under the 60 / 60 s per-user limit). Pass:
 *   server_total{name:onboarding_patch} p95 < 150 ms (Server-Timing `total`; abortOnFail)
 *   onboarding_patch_errors = 0
 *
 * Env:
 *   WEB_APP_URL, CLERK_SECRET_KEY (sk_test_…), VERCEL_AUTOMATION_BYPASS_SECRET     as games-list.ts
 *   ONB_CLERK_USER_IDS | ONB_USER_EMAILS | ONB_TOKENS   one user per VU, at Plan
 *   ONB_VUS, ONB_DURATION        override 10 / 3m (local smoke: ONB_VUS=4 ONB_DURATION=20s); VUs ≤ users
 *   RESULT_FILE                  default ../results/p04-onboarding-patch-local.json (stage B: p04-onboarding-patch-<sha>.json)
 *
 *   cd perf/k6 && pnpm run build && CLERK_SECRET_KEY=sk_test_… ONB_USER_EMAILS=<pool logins> k6 run dist/onboarding-patch.js
 */
import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';
import type { Options } from 'k6/options';
import { bypassHeaders, closeSessions, currentToken, openSessions, serverTiming, type ClerkSetup } from '../lib/clerk-sessions';

declare const __ENV: Record<string, string | undefined>;

const BASE_URL = (__ENV.WEB_APP_URL || 'https://replay-chess-dev-replaychess007-1069.vercel.app').replace(/\/$/, '');
const VUS = Number(__ENV.ONB_VUS || 10);
const DURATION = __ENV.ONB_DURATION || '3m';
const RESULT_FILE = __ENV.RESULT_FILE || '../results/p04-onboarding-patch-local.json';

/** CT/http/p04-plain.ts ONBOARDING_GOALS, DAILY_MINUTES (wire values). */
const GOALS = ['stop_blundering', 'learn_openings', 'improve_endgames', 'study_legends', 'play_friends'];
const MINUTES = [5, 10, 20];

const serverTotal = new Trend('server_total', true);
const errors = new Rate('onboarding_patch_errors');

export const options: Options = {
  scenarios: { save: { executor: 'constant-vus', vus: VUS, duration: DURATION, exec: 'save' } },
  thresholds: {
    'server_total{name:onboarding_patch}': [{ threshold: 'p(95)<150', abortOnFail: true, delayAbortEval: '30s' }],
    onboarding_patch_errors: ['rate==0'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup(): ClerkSetup {
  return openSessions('ONB', VUS);
}

export function teardown(data: ClerkSetup): void {
  closeSessions(data);
}

export function save(data: ClerkSetup): void {
  const goals = GOALS.filter(() => Math.random() < 0.5);
  const body = JSON.stringify({
    step: 'plan',
    goals: goals.length ? goals : [GOALS[0]],
    dailyMinutes: MINUTES[Math.floor(Math.random() * MINUTES.length)],
    timeZone: 'Asia/Kolkata',
  });
  const res = http.patch(`${BASE_URL}/api/me/onboarding`, body, {
    headers: { ...bypassHeaders(), Authorization: `Bearer ${currentToken(data)}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    tags: { name: 'onboarding_patch' },
  });
  const timing = serverTiming(res.headers['Server-Timing']);
  if (timing.total !== undefined) serverTotal.add(timing.total, { name: 'onboarding_patch' });
  errors.add(res.status !== 200);
  check(res, { 'PATCH 200': (r) => r.status === 200 });
  sleep(1.2 + 0.6 * Math.random());
}

type Summary = { metrics: Record<string, { values?: Record<string, number> }> };

export function handleSummary(summary: Summary): Record<string, string> {
  const v = (metric: string, stat: string) => summary.metrics[metric]?.values?.[stat];
  const fmt = (n: number | undefined, unit = 'ms') => (n === undefined || Number.isNaN(n) ? 'n/a' : `${n.toFixed(1)}${unit}`);
  const text = [
    '',
    `PATCH /api/me/onboarding against ${BASE_URL} (${VUS} VUs, ${DURATION})`,
    `  server_total p95  ${fmt(v('server_total{name:onboarding_patch}', 'p(95)') ?? v('server_total', 'p(95)'))} (threshold 150ms)`,
    `  client p95        ${fmt(v('http_req_duration{name:onboarding_patch}', 'p(95)') ?? v('http_req_duration', 'p(95)'))}`,
    `  errors            ${fmt((v('onboarding_patch_errors', 'rate') ?? NaN) * 100, '%')} (threshold 0%)`,
    `  summary JSON      ${RESULT_FILE}`,
    '',
  ].join('\n');
  return { stdout: text, [RESULT_FILE]: JSON.stringify(summary, null, 2) };
}
