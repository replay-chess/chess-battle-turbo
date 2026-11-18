/**
 * The nightly dev recompute check (phase-06 plan §12.4 "Nightly on dev", TE P6 / X2; nightly.yml job
 * `weakness-recompute-check`). Catches drift between the repository's weakness code (TRN compute, the v1 baseline, the
 * tagger's themes the bank holds) and what the deployed dev worker writes:
 *
 *   1. the job has reset a pool user to `weak-member` on the Neon dev branch (apps/web/scripts/dev/personas.ts: real
 *      CC0 games graded by the dev worker, kept between nights while they are under 6 h old, re-graded otherwise);
 *   2. this script asks for a recompute through the DEV SITE's TR-12 (POST /api/train/weakness/recompute, a Clerk
 *      development session of the pool user) → 202;
 *   3. waits ≤ `--timeout-sec` (120) for the snapshot the REAL dev worker writes after that request;
 *   4. recomputes the same snapshot here, read-only, with the repository's own steps on the same rows (the worker's
 *      context, scope, inputs, heal plan, `computeWeakness` with the default baseline, the examples) at the worker's
 *      `computedAt`;
 *   5. compares status, counts, headline and the metrics document with the times normalised away. A difference
 *      fails the job (exit 1; the workflow opens a `weakness-drift` issue) and the JSON report names each path.
 *
 *   cd apps/analysis-worker && WORKER_DATABASE_URL=<dev branch, replay_worker> CLERK_SECRET_KEY=sk_test_… \
 *     npx tsx scripts/nightly-weakness-check.ts --user <pool email> --user-ref-file <file> --base-url <dev url> \
 *       [--timeout-sec 120] [--out <file>]
 *
 * The email is only the Clerk sign-in. The database row is found by its reference id (FIX-1): replay_worker may read
 * users.id and "referenceId", never the email (replay_worker.p6.sql asserts it), so the persona step that reset the
 * user with the owner's connection writes the ref to a file (`personas.ts --ref-out`) and this script reads it.
 *
 * Guards: the database must be the Neon dev endpoint (ep-fancy-dust-b8b3dp81) or a local Postgres; the site must not
 * be the production domain; the Clerk key must be a development key. It never writes to the database (reads only; the
 * recompute it asks for is the dev site's own TR-12). Secrets are never printed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_BASELINE_ID } from "@repo/chess-training/baselines/load";
import { attachExamples, computeWeakness } from "@repo/chess-training/weakness/compute";
import { ALGO_VERSION } from "@repo/chess-training/weakness/constants";
import { CountingDb, pgDriver, stmt, type Db } from "../src/db/client";
import { workerBaseline } from "../src/weakness/baseline";
import { loadWeaknessContext, scopeOf } from "../src/weakness/context";
import { loadExamples } from "../src/weakness/examples";
import { applyHeal, planHeal } from "../src/weakness/heal";
import { loadWeaknessInputs } from "../src/weakness/load";

const DEV_HOST = /^ep-fancy-dust-b8b3dp81(-pooler)?\.c-14\.us-east-1\.aws\.neon\.tech$/;
const LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);
const CLERK_API = "https://api.clerk.com/v1";

export class CheckError extends Error {}

export type Args = { user: string; userRef: string; baseUrl: string; timeoutSec: number; out: string | null };

const REF_RE = /^[A-Za-z0-9_-]{8,40}$/;

export function parseArgs(argv: readonly string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const user = get("--user");
  const baseUrl = get("--base-url")?.replace(/\/+$/, "");
  const refFile = get("--user-ref-file");
  const userRef = (get("--user-ref") ?? (refFile ? readFileSync(refFile, "utf8") : "")).trim();
  if (!user || !baseUrl || !userRef) {
    throw new CheckError("usage: nightly-weakness-check.ts --user <pool email> (--user-ref <ref> | --user-ref-file <file>) --base-url <dev url> [--timeout-sec 120] [--out <file>]");
  }
  if (!REF_RE.test(userRef)) throw new CheckError("--user-ref is not a user reference id");
  if (/(^|\.)playchess\.tech$/i.test(new URL(baseUrl).hostname)) throw new CheckError("refusing the production site");
  const timeoutSec = Number(get("--timeout-sec") ?? 120);
  if (!Number.isInteger(timeoutSec) || timeoutSec < 10 || timeoutSec > 900) throw new CheckError("--timeout-sec must be 10..900");
  return { user, userRef, baseUrl, timeoutSec, out: get("--out") ?? null };
}

/** The dev endpoint or a local Postgres; the host is returned (never the URL). */
export function assertTarget(url: string | undefined): string {
  if (!url) throw new CheckError("WORKER_DATABASE_URL is not set");
  const host = new URL(url).hostname;
  if (!DEV_HOST.test(host) && !LOCAL.has(host)) throw new CheckError(`refusing ${host}: the Neon dev endpoint or a local Postgres only`);
  return host;
}

/** Times and per-run values out: ISO instants become "<time>", `inputs.at` and `computedAt` are dropped. */
export function normalise(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v), (k, x) => {
    if (k === "computedAt" || k === "at") return undefined;
    if (typeof x === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z$/.test(x)) return "<time>";
    if (typeof x === "number" && !Number.isInteger(x)) return Math.round(x * 1e6) / 1e6;
    return x;
  });
}

/** Every path where `a` and `b` differ (`$.rows[0].you: 3.1 ≠ 3.2`), at most `max`. */
export function diffPaths(a: unknown, b: unknown, at = "$", out: string[] = [], max = 40): string[] {
  if (out.length >= max) return out;
  if (Object.is(a, b)) return out;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    out.push(`${at}: ${JSON.stringify(a)?.slice(0, 80)} ≠ ${JSON.stringify(b)?.slice(0, 80)}`);
    return out;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${at}: array vs object`);
    return out;
  }
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  for (const k of keys) diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], Array.isArray(a) ? `${at}[${k}]` : `${at}.${k}`, out, max);
  return out;
}

async function clerkToken(email: string, key: string): Promise<{ jwt: string; sessionId: string }> {
  if (!key.startsWith("sk_test_")) throw new CheckError("CLERK_SECRET_KEY must be the development key (sk_test_…)");
  const h = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const users = (await (await fetch(`${CLERK_API}/users?email_address=${encodeURIComponent(email)}`, { headers: h })).json()) as { id: string }[];
  if (!users[0]) throw new CheckError("the pool user has no Clerk identity on the development instance");
  const s = (await (await fetch(`${CLERK_API}/sessions`, { method: "POST", headers: h, body: JSON.stringify({ user_id: users[0].id }) })).json()) as { id: string };
  const t = (await (await fetch(`${CLERK_API}/sessions/${s.id}/tokens`, { method: "POST", headers: h, body: "{}" })).json()) as { jwt: string };
  return { jwt: t.jwt, sessionId: s.id };
}

/** `timestamp(3) without time zone` holding UTC, as the driver hands it back (a Date or its text). */
export function utcOf(v: unknown): Date {
  if (v instanceof Date) return v;
  const t = String(v);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t.replace(" ", "T")}Z`);
}

type SnapshotRow = { status: string; gamesAnalysed: number; gamesInScope: number; headline: string | null; metrics: unknown; computedAt: Date };

async function latestSnapshot(db: Db, userId: string): Promise<SnapshotRow | null> {
  const rows = await db.query(
    stmt(
      `SELECT status::text AS status, "gamesAnalysed", "gamesInScope", headline, metrics,
              to_char("computedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "computedAt"
         FROM weakness_snapshots WHERE "userId" = $1::bigint ORDER BY "weekStart" DESC LIMIT 1`,
      [userId],
    ),
  );
  const r = rows[0];
  return r ? { ...(r as unknown as SnapshotRow), computedAt: utcOf(r.computedAt) } : null;
}

/** The snapshot the repository's code computes from the same rows, at the worker's computedAt (reads only). */
export async function dryRecompute(db: Db, userId: string, at: Date) {
  const c = await loadWeaknessContext(db, userId);
  if (!c) throw new CheckError("the user is gone");
  const { scope, since } = scopeOf(c, at);
  const inputs = await loadWeaknessInputs(db, userId, since, scope.timeClasses);
  const heal = await planHeal(db, inputs, () => undefined);
  applyHeal(inputs, heal.rows);
  const draft = computeWeakness(inputs, workerBaseline(), { now: at, timeZone: c.timeZone, profile: c.profile, ratingBand: c.ratingBand, healed: heal.rows.length });
  const examples = draft.status === "READY" ? await loadExamples(db, userId, draft.metrics.rows.map((r) => r.pattern)) : new Map();
  return { ...draft, metrics: attachExamples(draft.metrics, examples) };
}

/** The pool user's id by its reference id: the only user columns replay_worker may read are id and "referenceId". */
export async function userIdOf(db: Db, userRef: string): Promise<string | undefined> {
  const rows = await db.query(stmt(`SELECT id::text AS id FROM users WHERE "referenceId" = $1`, [userRef]));
  return rows[0]?.id as string | undefined;
}

export async function main(argv: readonly string[], env: Readonly<Record<string, string | undefined>> = process.env): Promise<number> {
  const args = parseArgs(argv);
  const host = assertTarget(env.WORKER_DATABASE_URL);
  console.log(`[weakness-check] database ${host}; site ${new URL(args.baseUrl).host}`);
  const db = new CountingDb(pgDriver(env.WORKER_DATABASE_URL!));
  const report: Record<string, unknown> = { at: new Date().toISOString(), site: new URL(args.baseUrl).host, baseline: DEFAULT_BASELINE_ID, algoVersion: ALGO_VERSION };
  let token: { jwt: string; sessionId: string } | null = null;
  try {
    const userId = await userIdOf(db, args.userRef);
    if (!userId) throw new CheckError("the pool user has no row on this database (reset it to weak-member first)");
    const before = await latestSnapshot(db, userId);
    token = await clerkToken(args.user, env.CLERK_SECRET_KEY ?? "");
    const bypass = env.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};
    const asked = Date.now();
    const res = await fetch(`${args.baseUrl}/api/train/weakness/recompute`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.jwt}`, "content-type": "application/json", ...bypass },
      body: "{}",
    });
    report.tr12 = res.status;
    if (res.status !== 202) throw new CheckError(`TR-12 answered ${res.status} (a 429 means a recompute was asked for within 10 minutes)`);
    let snap: SnapshotRow | null = null;
    for (const deadline = asked + args.timeoutSec * 1000; Date.now() < deadline; ) {
      const s = await latestSnapshot(db, userId);
      if (s && s.computedAt.getTime() >= asked - 2_000 && (!before || s.computedAt.getTime() > before.computedAt.getTime())) {
        snap = s;
        break;
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }
    if (!snap) throw new CheckError(`the dev worker wrote no snapshot within ${args.timeoutSec} s of TR-12`);
    report.workerLagMs = snap.computedAt.getTime() - asked;
    const dry = await dryRecompute(db, userId, snap.computedAt);
    const worker = { status: snap.status, gamesAnalysed: Number(snap.gamesAnalysed), gamesInScope: Number(snap.gamesInScope), headline: snap.headline, metrics: normalise(snap.metrics) };
    const repo = { status: dry.status, gamesAnalysed: dry.gamesAnalysed, gamesInScope: dry.gamesInScope, headline: dry.headline, metrics: normalise(dry.metrics) };
    const diffs = diffPaths(worker, repo);
    const baselineId = (snap.metrics as { inputs?: { baseline?: string } } | null)?.inputs?.baseline ?? null;
    if (baselineId !== DEFAULT_BASELINE_ID) diffs.unshift(`$.metrics.inputs.baseline: the worker used ${baselineId}, the repository ${DEFAULT_BASELINE_ID}`);
    report.status = snap.status;
    report.games = { analysed: worker.gamesAnalysed, inScope: worker.gamesInScope };
    report.diffs = diffs;
    report.ok = diffs.length === 0 && snap.status === "READY";
    console.log(`[weakness-check] TR-12 202, snapshot ${snap.status} ${worker.gamesAnalysed}/${worker.gamesInScope} after ${report.workerLagMs} ms; ${diffs.length} difference(s)`);
    for (const d of diffs) console.log(`  ${d}`);
    return report.ok ? 0 : 1;
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? error.message : String(error);
    console.error(`[weakness-check] ${report.error as string}`);
    return 1;
  } finally {
    if (token) {
      await fetch(`${CLERK_API}/sessions/${token.sessionId}/revoke`, { method: "POST", headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY ?? ""}` } }).catch(() => undefined);
    }
    if (args.out) writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
    await db.close?.();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof CheckError ? `[weakness-check] ${error.message}` : error);
      process.exit(2);
    },
  );
}
