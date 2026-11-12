/**
 * Clerk sessions for k6 scenarios that call member routes (phase-03 plan §12.7). route() `auth: "user"` needs a Clerk
 * session JWT, and session tokens live 60 s, so a run mints them through the Clerk Backend API of the DEVELOPMENT
 * instance (the pattern of scenarios/me.ts):
 *   setup     resolves the users (<PREFIX>_CLERK_USER_IDS, else <PREFIX>_USER_EMAILS looked up by email) and opens one
 *             session per user (POST /v1/sessions, development instances only);
 *   each VU   mints a JWT (POST /v1/sessions/{id}/tokens) and re-mints it every 45 s;
 *   teardown  revokes the sessions.
 * Or <PREFIX>_TOKENS (comma-separated fresh JWTs) for a run shorter than a token's life.
 * Never a production key: CLERK_SECRET_KEY must start with sk_test_.
 */
import { fail } from 'k6';
import http from 'k6/http';

declare const __ENV: Record<string, string | undefined>;
declare const __VU: number;

const CLERK_API = 'https://api.clerk.com/v1';
const TOKEN_REFRESH_MS = 45_000;

export type ClerkSetup = { mode: 'tokens'; tokens: string[] } | { mode: 'sessions'; sessionIds: string[] };

export function list(name: string): string[] {
  return (__ENV[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function clerkHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${__ENV.CLERK_SECRET_KEY || ''}`, 'Content-Type': 'application/json' };
}

/** The Vercel protection bypass of a protected dev deployment (Q-16), when its secret is set. */
export function bypassHeaders(): Record<string, string> {
  const secret = __ENV.VERCEL_AUTOMATION_BYPASS_SECRET;
  return secret ? { 'x-vercel-protection-bypass': secret } : {};
}

export function openSessions(prefix: string, maxUsers: number): ClerkSetup {
  const tokens = list(`${prefix}_TOKENS`);
  if (tokens.length) return { mode: 'tokens', tokens };
  if (!(__ENV.CLERK_SECRET_KEY || '').startsWith('sk_test_')) {
    fail(`Set CLERK_SECRET_KEY to the Clerk DEVELOPMENT secret key (sk_test_…), or pass ${prefix}_TOKENS`);
  }
  let userIds = list(`${prefix}_CLERK_USER_IDS`);
  if (!userIds.length) {
    for (const email of list(`${prefix}_USER_EMAILS`)) {
      const res = http.get(`${CLERK_API}/users?email_address=${encodeURIComponent(email)}`, { headers: clerkHeaders(), tags: { name: 'clerk' } });
      const found = res.status === 200 ? (res.json() as Array<{ id: string }>) : [];
      if (found.length) userIds.push(found[0]!.id);
      else console.warn(`[${prefix}] no Clerk user for one of ${prefix}_USER_EMAILS (status ${res.status})`);
    }
  }
  userIds = userIds.slice(0, maxUsers);
  if (!userIds.length) fail(`No users: set ${prefix}_CLERK_USER_IDS or ${prefix}_USER_EMAILS`);
  const sessionIds: string[] = [];
  for (const userId of userIds) {
    const res = http.post(`${CLERK_API}/sessions`, JSON.stringify({ user_id: userId }), { headers: clerkHeaders(), tags: { name: 'clerk' } });
    if (res.status !== 200) fail(`Clerk POST /v1/sessions answered ${res.status} (development instances only)`);
    sessionIds.push((res.json() as { id: string }).id);
  }
  return { mode: 'sessions', sessionIds };
}

export function closeSessions(data: ClerkSetup): void {
  if (data.mode !== 'sessions') return;
  for (const id of data.sessionIds) {
    http.post(`${CLERK_API}/sessions/${id}/revoke`, null, { headers: clerkHeaders(), tags: { name: 'clerk' } });
  }
}

export function mint(sessionId: string): string {
  const res = http.post(`${CLERK_API}/sessions/${sessionId}/tokens`, '{}', { headers: clerkHeaders(), tags: { name: 'clerk' } });
  if (res.status !== 200) fail(`Clerk session token answered ${res.status}`);
  return (res.json() as { jwt: string }).jwt;
}

// Per-VU state (each VU is its own JS runtime).
let token = '';
let tokenAt = 0;

/** This VU's current session JWT (VUs share users round-robin). */
export function currentToken(data: ClerkSetup): string {
  if (data.mode === 'tokens') return data.tokens[(__VU - 1) % data.tokens.length]!;
  if (!token || Date.now() - tokenAt > TOKEN_REFRESH_MS) {
    token = mint(data.sessionIds[(__VU - 1) % data.sessionIds.length]!);
    tokenAt = Date.now();
  }
  return token;
}

/** `auth;dur=1.2, db;dur=3.4, total;dur=10.1` → { auth: 1.2, db: 3.4, total: 10.1 } */
export function serverTiming(header: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (header || '').split(',')) {
    const m = /^\s*([a-z0-9_-]+)\s*;\s*dur=([\d.]+)/i.exec(part);
    if (m) out[m[1]!] = Number(m[2]);
  }
  return out;
}

/** "90s" / "5m" → seconds. */
export function seconds(d: string): number {
  const m = /^(\d+)(s|m)$/.exec(d);
  if (!m) throw new Error(`duration must look like 90s or 5m, got ${d}`);
  return Number(m[1]) * (m[2] === 'm' ? 60 : 1);
}
