/**
 * A training session under load (phase-05 plan §12.6, §9.6; testing X18).
 *
 * `TRAIN_VUS` VUs (default 20) for `TRAIN_DURATION` (5m), each a member running sessions the way the runner does:
 *   W2  POST /api/train/sessions with an `Idempotency-Key`, alternating a Mistake Bank practice session (explicit
 *       re-drills of the member's own positions, so a long run never empties the due queue) and a 10-puzzle session;
 *   W1  POST /api/train/attempts for each item after a 3–6 s think time, 20 % of them held and sent as batches of 5
 *       (the outbox's flush); the last applied batch of every session is sent again and must come back all
 *       `duplicate`;
 *   W4  POST /api/train/sessions/{ref}/end.
 * Pass (client):
 *   http_req_duration{name:attempts}       p95 < 150 ms (W1 at ≈ 20 RPS)
 *   http_req_duration{name:create_bank}    p95 < 250 ms (W2 BANK)
 *   http_req_duration{name:create_puzzles} p95 < 400 ms (W2 PUZZLES; run against a fresh deployment for a cold LRU)
 *   duplicates_idempotent = 100 %, train_errors = 0
 * `server_total` (Server-Timing) is recorded per name for the record.
 *
 * Env:
 *   WEB_APP_URL, CLERK_SECRET_KEY (sk_test_…), VERCEL_AUTOMATION_BYPASS_SECRET   as import-status.ts
 *   TRAIN_CLERK_USER_IDS | TRAIN_USER_EMAILS | TRAIN_TOKENS   members with a bank (pool users reset to `bank-member`:
 *                                                         cd apps/web && npx tsx scripts/dev/personas.ts --reset 1 --persona bank-member)
 *   TRAIN_VUS, TRAIN_DURATION                             override 20 / 5m (local smoke: TRAIN_VUS=2 TRAIN_DURATION=40s)
 *   RESULT_FILE                                           default ../results/p05-train-session-local.json
 * Never production; before a dev run check the replay-chess-dev usage page and skip above 60 % of any Hobby quota.
 *
 *   cd perf/k6 && pnpm run build && CLERK_SECRET_KEY=sk_test_… TRAIN_USER_EMAILS=<pool logins> k6 run dist/train-session.js
 */
import { check, sleep } from 'k6';
import http, { type RefinedResponse, type ResponseType } from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';
import type { Options } from 'k6/options';
import { bypassHeaders, closeSessions, currentToken, mint, openSessions, serverTiming, type ClerkSetup } from '../lib/clerk-sessions';

declare const __ENV: Record<string, string | undefined>;
declare const __ITER: number;

const BASE_URL = (__ENV.WEB_APP_URL || 'https://replay-chess-dev-replaychess007-1069.vercel.app').replace(/\/$/, '');
const VUS = Number(__ENV.TRAIN_VUS || 20);
const DURATION = __ENV.TRAIN_DURATION || '5m';
const RESULT_FILE = __ENV.RESULT_FILE || '../results/p05-train-session-local.json';
const ITEMS_PER_SESSION = 10;

const serverTotal = new Trend('server_total', true);
const errors = new Rate('train_errors');
const duplicatesIdempotent = new Rate('duplicates_idempotent');
/** Same-card grades from two VUs sharing a member (expected with fewer users than VUs; recorded, not an error). */
const conflicts = new Counter('attempt_conflicts');

export const options: Options = {
  scenarios: { train: { executor: 'constant-vus', vus: VUS, duration: DURATION, exec: 'train', gracefulStop: '30s' } },
  thresholds: {
    'http_req_duration{name:attempts}': ['p(95)<150'],
    'http_req_duration{name:create_bank}': ['p(95)<250'],
    'http_req_duration{name:create_puzzles}': ['p(95)<400'],
    duplicates_idempotent: ['rate==1'],
    train_errors: ['rate==0'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

type Item = { itemId: string; kind: string; cardRef: string | null; cardReps: number | null; puzzleId: string | null };
type Payload = { ref: string; items: Item[] };
type AttemptOut = { clientAttemptId: string; status: string };

function uuid(): string {
  // RFC 4122 v4 from Math.random (k6 has no crypto.randomUUID in every build); fine for idempotency keys and test ids.
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
    else if (i === 14) s += '4';
    else if (i === 19) s += h[(Math.random() * 4) | 8];
    else s += h[(Math.random() * 16) | 0];
  }
  return s;
}

function headers(data: ClerkSetup, extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...bypassHeaders(),
    Authorization: `Bearer ${currentToken(data)}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Origin: BASE_URL,
    ...extra,
  };
}

function record(res: RefinedResponse<ResponseType | undefined>, name: string): void {
  const t = serverTiming(res.headers['Server-Timing']);
  if (t.total !== undefined) serverTotal.add(t.total, { name });
}

function attemptFor(p: Payload, it: Item): Record<string, unknown> {
  return {
    clientAttemptId: uuid(),
    sessionRef: p.ref,
    itemId: it.itemId,
    cardRef: it.cardRef,
    puzzleId: it.puzzleId,
    kind: it.kind,
    solved: true,
    firstTry: true,
    hintsUsed: 0,
    wrongMovesUci: [],
    solutionShown: false,
    timeMs: 3_000 + Math.floor(Math.random() * 3_000),
    grade: 'good',
    suggestedGrade: 'good',
    cardReps: it.cardReps,
    reviewedAt: new Date().toISOString(),
  };
}

function send(data: ClerkSetup, attempts: Record<string, unknown>[]): AttemptOut[] {
  const res = http.post(`${BASE_URL}/api/train/attempts`, JSON.stringify({ attempts }), { headers: headers(data), tags: { name: 'attempts' } });
  record(res, 'attempts');
  const ok = check(res, { 'attempts 200': (r) => r.status === 200 });
  errors.add(!ok);
  if (!ok) return [];
  return ((res.json() as { data: { results: AttemptOut[] } }).data?.results ?? []) as AttemptOut[];
}

export function setup(): ClerkSetup {
  const clerk = openSessions('TRAIN', 20);
  const warm = clerk.mode === 'tokens' ? clerk.tokens[0]! : mint(clerk.sessionIds[0]!);
  const res = http.get(`${BASE_URL}/api/train/today`, { headers: { ...bypassHeaders(), Authorization: `Bearer ${warm}` }, tags: { name: 'warmup' } });
  check(res, { 'warm-up 200': (r) => r.status === 200 });
  return clerk;
}

export function teardown(data: ClerkSetup): void {
  closeSessions(data);
}

export function train(data: ClerkSetup): void {
  const puzzles = __ITER % 2 === 1;
  const body = puzzles ? { kind: 'puzzles', source: 'nav', count: ITEMS_PER_SESSION } : { kind: 'bank', source: 'bank', practice: true };
  const name = puzzles ? 'create_puzzles' : 'create_bank';
  const created = http.post(`${BASE_URL}/api/train/sessions`, JSON.stringify(body), { headers: headers(data, { 'Idempotency-Key': uuid() }), tags: { name } });
  record(created, name);
  const ok = check(created, { 'session 201': (r) => r.status === 201 || r.status === 200 });
  errors.add(!ok);
  if (!ok) {
    sleep(5);
    return;
  }
  const payload = (created.json() as { data: Payload }).data;
  // VUs share members round-robin, so two VUs can grade the same card: the later one is a `conflict` (the outbox drops
  // it silently). Only attempts the server applied (`ok`) are replayed, and every replay must be a `duplicate`.
  let held: Record<string, unknown>[] = [];
  let applied: Record<string, unknown>[] = [];
  const flush = (batch: Record<string, unknown>[]) => {
    const results = send(data, batch);
    const ok = new Set(results.filter((r) => r.status === 'ok').map((r) => r.clientAttemptId));
    conflicts.add(results.filter((r) => r.status === 'conflict').length);
    applied = batch.filter((a) => ok.has(a.clientAttemptId as string));
  };
  for (const it of payload.items.slice(0, ITEMS_PER_SESSION)) {
    sleep(3 + Math.random() * 3);
    const a = attemptFor(payload, it);
    if (held.length || Math.random() < 0.2) {
      held.push(a);
      if (held.length === 5) {
        flush(held);
        held = [];
      }
    } else {
      flush([a]);
    }
  }
  if (held.length) flush(held);
  // A lost response replayed by the outbox: the same attempts again are all duplicates.
  if (applied.length) {
    const again = send(data, applied);
    const idempotent = again.length === applied.length && again.every((r) => r.status === 'duplicate');
    duplicatesIdempotent.add(idempotent);
    if (!idempotent) console.warn(`[train-session] replay of ${applied.length} applied attempt(s) (${body.kind}) answered ${again.map((r) => r.status).join(',') || 'no results'}`);
  }
  const ended = http.post(`${BASE_URL}/api/train/sessions/${payload.ref}/end`, JSON.stringify({ reason: 'done' }), { headers: headers(data), tags: { name: 'end' } });
  record(ended, 'end');
  const endOk = check(ended, { 'end 200': (r) => r.status === 200 });
  errors.add(!endOk);
}

type Summary = { metrics: Record<string, { values?: Record<string, number> }> };

export function handleSummary(summary: Summary): Record<string, string> {
  const v = (metric: string, stat: string) => summary.metrics[metric]?.values?.[stat];
  const fmt = (n: number | undefined, unit = 'ms') => (n === undefined || Number.isNaN(n) ? 'n/a' : `${n.toFixed(1)}${unit}`);
  const text = [
    '',
    `Training sessions against ${BASE_URL} (${VUS} VUs, ${DURATION})`,
    `  W1 attempts p95        ${fmt(v('http_req_duration{name:attempts}', 'p(95)'))} (threshold 150ms)`,
    `  W2 BANK p95            ${fmt(v('http_req_duration{name:create_bank}', 'p(95)'))} (threshold 250ms)`,
    `  W2 PUZZLES p95         ${fmt(v('http_req_duration{name:create_puzzles}', 'p(95)'))} (threshold 400ms)`,
    `  duplicates idempotent  ${fmt((v('duplicates_idempotent', 'rate') ?? NaN) * 100, '%')} (threshold 100%)`,
    `  errors                 ${fmt((v('train_errors', 'rate') ?? NaN) * 100, '%')} (threshold 0%)`,
    `  summary JSON           ${RESULT_FILE}`,
    '',
  ].join('\n');
  return { stdout: text, [RESULT_FILE]: JSON.stringify(summary, null, 2) };
}
