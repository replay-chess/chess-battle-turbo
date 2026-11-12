/**
 * The review read A1 `GET /api/review/<ref>` (phase-03 plan §9.1, §9.2, §12.7 "Review read").
 *
 * 50 VUs × 5 min over the 40 seeded reviews of the review seed's member (packages/db/seed/review.ts: GAME, CLEAN,
 * LEGEND, LEGEND_KT, UNANALYSED, archive-01…35), 70 % of the requests revalidations (If-None-Match with the ETag this
 * VU last saw for that review). Pass:
 *   server_total{name:review} p95 < 160 ms (Server-Timing `total`, the server-side measure; abortOnFail)
 *   not_modified_rate (304 among revalidations) ≥ 60 %
 *   review_errors (any status but 200/304) = 0
 * The refs are the seed's deterministic ones (`c` + sha256("p3-seed:<key>:<member ref>")[0..24]); the member ref comes
 * from GET /api/me with the run's session, or REVIEW_REFS lists them.
 *
 * Env:
 *   WEB_APP_URL                         default: the replay-chess-dev URL (never production)
 *   CLERK_SECRET_KEY                    the Clerk development instance's secret key (sk_test_…)
 *   REVIEW_CLERK_USER_IDS | REVIEW_USER_EMAILS | REVIEW_TOKENS   the seeded member (e2e user A on dev)
 *   REVIEW_REFS                         optional comma-separated refs instead of the seed's
 *   REVIEW_VUS, REVIEW_DURATION         override 50 / 5m (a local smoke: REVIEW_VUS=2 REVIEW_DURATION=20s)
 *   REVALIDATE_SHARE                    default 0.7
 *   RESULT_FILE                         JSON summary (default ../results/p03-review-read-local.json; CI and stage B
 *                                       name it p03-review-read-<sha>.json, TST X18)
 *   VERCEL_AUTOMATION_BYPASS_SECRET     when the dev deployment is protected
 *
 *   cd perf/k6 && pnpm run build && CLERK_SECRET_KEY=sk_test_… REVIEW_USER_EMAILS=<member A> k6 run dist/review-read.js
 */
import { check, fail, sleep } from 'k6';
import crypto from 'k6/crypto';
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';
import type { Options } from 'k6/options';
import { bypassHeaders, closeSessions, currentToken, list, openSessions, serverTiming, type ClerkSetup } from '../lib/clerk-sessions';

declare const __ENV: Record<string, string | undefined>;

const BASE_URL = (__ENV.WEB_APP_URL || 'https://replay-chess-dev-replaychess007-1069.vercel.app').replace(/\/$/, '');
const VUS = Number(__ENV.REVIEW_VUS || 50);
const DURATION = __ENV.REVIEW_DURATION || '5m';
const REVALIDATE_SHARE = Number(__ENV.REVALIDATE_SHARE || 0.7);
const RESULT_FILE = __ENV.RESULT_FILE || '../results/p03-review-read-local.json';

/** The review seed's 40 games (packages/db/seed/review.ts reviewFixtures). */
export const SEED_KEYS = [
  'GAME',
  'CLEAN',
  'LEGEND',
  'LEGEND_KT',
  'UNANALYSED',
  ...Array.from({ length: 35 }, (_, i) => `archive-${String(i + 1).padStart(2, '0')}`),
];

export function seededRef(key: string, memberRef: string): string {
  return `c${crypto.sha256(`p3-seed:${key}:${memberRef}`, 'hex').slice(0, 24)}`;
}

const serverTotal = new Trend('server_total', true);
const serverDb = new Trend('server_db', true);
const notModified = new Rate('not_modified_rate');
const errors = new Rate('review_errors');

export const options: Options = {
  scenarios: {
    read: { executor: 'constant-vus', vus: VUS, duration: DURATION, exec: 'read' },
  },
  thresholds: {
    'server_total{name:review}': [{ threshold: 'p(95)<160', abortOnFail: true, delayAbortEval: '30s' }],
    not_modified_rate: ['rate>=0.6'],
    review_errors: ['rate==0'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

type Data = { clerk: ClerkSetup; refs: string[] };

export function setup(): Data {
  const clerk = openSessions('REVIEW', 1);
  let refs = list('REVIEW_REFS');
  if (!refs.length) {
    const me = http.get(`${BASE_URL}/api/me`, {
      headers: { ...bypassHeaders(), Authorization: `Bearer ${currentToken(clerk)}`, Accept: 'application/json' },
      tags: { name: 'setup' },
    });
    if (me.status !== 200) fail(`GET /api/me answered ${me.status}`);
    const memberRef = (me.json() as { data: { user: { ref: string } } }).data.user.ref;
    refs = SEED_KEYS.map((k) => seededRef(k, memberRef));
  }
  // Warm-up: one read per review, so a first render (ISR, DB wake) is not measured.
  for (const ref of refs) {
    const res = http.get(`${BASE_URL}/api/review/${ref}`, { headers: { ...bypassHeaders(), Authorization: `Bearer ${currentToken(clerk)}` }, tags: { name: 'warmup' } });
    if (res.status !== 200) fail(`warm-up GET /api/review/<ref> answered ${res.status}: is the review seed loaded for this member?`);
  }
  console.log(`[review-read] ${refs.length} reviews against ${BASE_URL}`);
  return { clerk, refs };
}

export function teardown(data: Data): void {
  closeSessions(data.clerk);
}

// Per-VU ETags by ref.
const etags: Record<string, string> = {};

export function read(data: Data): void {
  const ref = data.refs[Math.floor(Math.random() * data.refs.length)]!;
  const headers: Record<string, string> = { ...bypassHeaders(), Authorization: `Bearer ${currentToken(data.clerk)}`, Accept: 'application/json' };
  const revalidate = Boolean(etags[ref]) && Math.random() < REVALIDATE_SHARE;
  if (revalidate) headers['If-None-Match'] = etags[ref]!;
  const res = http.get(`${BASE_URL}/api/review/${ref}`, { headers, tags: { name: 'review' } });
  const timing = serverTiming(res.headers['Server-Timing']);
  if (timing.total !== undefined) serverTotal.add(timing.total, { name: 'review' });
  if (timing.db !== undefined) serverDb.add(timing.db, { name: 'review' });
  const ok = res.status === 200 || res.status === 304;
  errors.add(!ok);
  if (revalidate) notModified.add(res.status === 304);
  const etag = res.headers['Etag'] || res.headers['ETag'];
  if (res.status === 200 && etag) etags[ref] = String(etag);
  check(res, {
    'review 200 or 304': () => ok,
    'review is private, no-store or revalidated': (r) => /private/.test(String(r.headers['Cache-Control'] || '')),
  });
  sleep(0.2 + Math.random() * 0.6);
}

type Summary = { metrics: Record<string, { values?: Record<string, number> }> };

export function handleSummary(summary: Summary): Record<string, string> {
  const v = (metric: string, stat: string) => summary.metrics[metric]?.values?.[stat];
  const fmt = (n: number | undefined, unit = 'ms') => (n === undefined || Number.isNaN(n) ? 'n/a' : `${n.toFixed(1)}${unit}`);
  const text = [
    '',
    `GET /api/review/<ref> against ${BASE_URL}`,
    `  server_total p95  ${fmt(v('server_total{name:review}', 'p(95)') ?? v('server_total', 'p(95)'))} (threshold 160ms)`,
    `  server_db p95     ${fmt(v('server_db', 'p(95)'))}`,
    `  client p95        ${fmt(v('http_req_duration{name:review}', 'p(95)') ?? v('http_req_duration', 'p(95)'))}`,
    `  304 share         ${fmt((v('not_modified_rate', 'rate') ?? NaN) * 100, '%')} (threshold 60%)`,
    `  errors            ${fmt((v('review_errors', 'rate') ?? NaN) * 100, '%')} (threshold 0%)`,
    `  summary JSON      ${RESULT_FILE}`,
    '',
  ].join('\n');
  return { stdout: text, [RESULT_FILE]: JSON.stringify(summary, null, 2) };
}
