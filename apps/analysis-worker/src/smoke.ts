// The post-deploy real-engine smoke (phase-03 plan §12.8, owner test T22), run inside the worker container right
// after `docker compose up -d` by deploy-oci.yml (`docker compose exec -T analysis-worker node dist/smoke.cjs`):
//
//   1. reset the seeded smoke game (`smoke-26`, DB/seed/smoke.ts): its player_reviews and game_analyses rows and its
//      job go, games."analysisStatus" goes back to NONE (one batch);
//   2. enqueue it at USER_OPENED with reason "smoke" (the shared `enqueueAnalysisSql`);
//   3. kick the running worker on localhost:3003, signed with the container's `opswk` key (else `webwk`);
//   4. poll the database every 5 s, at most 24 times: DONE, gradedPlies = the game's plies, every ply graded, a
//      player_reviews row, and `readyMs` null (smoke runs are excluded from the SLO data).
//
// It uses the worker's own environment (loadEnv: the same database role, key ring and port), prints one JSON line
// per step and exits 0 when every check holds, 1 otherwise. It never prints a URL or a key.
import { OPS_TO_WORKER_KID, signInternal, WEB_TO_WORKER_KID, type KeyRing } from "@repo/contracts/internal/auth";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { KICK_PATH } from "@repo/contracts/internal/kick";
import { enqueueAnalysisSql } from "@repo/db/jobs";
import { fromPrisma, idStr, num, numOrNull, stmt, type Db, type Statement } from "./db/client";
import { NOW } from "./queue/claim";

/** The smoke game every database carries (DB/seed/smoke.ts SMOKE_GAME_REF; 26 plies vs Engine 1200). */
export const SMOKE_GAME_REF = "ce79ed7837da5c852da53f8aa";
export const SMOKE_POLL_MS = 5_000;
export const SMOKE_MAX_POLLS = 24;

export interface SmokeOptions {
  db: Db;
  keys: KeyRing;
  /** The worker's base URL, e.g. http://127.0.0.1:3003. */
  workerUrl: string;
  ref?: string;
  pollMs?: number;
  maxPolls?: number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  log?: (line: Record<string, unknown>) => void;
}

export interface SmokeState {
  analysisStatus: string;
  plyCount: number;
  gradedPlies: number | null;
  judgements: number[];
  readyMs: number | null;
  reviews: number;
  jobStatus: string | null;
  lastError: string | null;
}

export interface SmokeResult {
  ok: boolean;
  polls: number;
  failures: string[];
  state: SmokeState | null;
}

export function resetStatements(gameId: string): Statement[] {
  return [
    stmt(`DELETE FROM player_reviews WHERE "gameId" = $1::bigint`, [gameId]),
    stmt(`DELETE FROM game_analyses WHERE "gameId" = $1::bigint`, [gameId]),
    stmt(`DELETE FROM jobs WHERE "dedupeKey" = $1`, [`analyze:${gameId}`]),
    stmt(`UPDATE games SET "analysisStatus" = 'NONE', "updatedAt" = ${NOW} WHERE id = $1::bigint`, [gameId]),
  ];
}

export function stateStatement(gameId: string): Statement {
  return stmt(
    `SELECT g."analysisStatus"::text AS "analysisStatus", g."plyCount",
       a."gradedPlies", a.judgements, a."readyMs",
       (SELECT count(*) FROM player_reviews pr WHERE pr."gameId" = g.id)::int AS reviews,
       j.status::text AS "jobStatus", j."lastError"
  FROM games g
  LEFT JOIN game_analyses a ON a."gameId" = g.id
  LEFT JOIN jobs j ON j."dedupeKey" = 'analyze:' || g.id::text
 WHERE g.id = $1::bigint`,
    [gameId],
  );
}

/** What the smoke asserts once the job is no longer running (§12.8). Empty = pass. */
export function smokeFailures(s: SmokeState): string[] {
  const out: string[] = [];
  if (s.analysisStatus !== "DONE") out.push(`analysisStatus is ${s.analysisStatus}`);
  if (s.gradedPlies !== s.plyCount) out.push(`gradedPlies ${String(s.gradedPlies)} ≠ ${s.plyCount} plies`);
  if (s.judgements.length !== s.plyCount || s.judgements.some((j) => j < 1 || j > 12))
    out.push("not every ply has a judgement");
  if (s.reviews < 1) out.push("no player_reviews row");
  if (s.readyMs !== null) out.push("readyMs is set (smoke runs must be excluded from the SLO data)");
  return out;
}

function toState(row: Record<string, unknown>): SmokeState {
  return {
    analysisStatus: String(row.analysisStatus),
    plyCount: num(row.plyCount),
    gradedPlies: numOrNull(row.gradedPlies),
    judgements: Array.isArray(row.judgements) ? row.judgements.map((x) => num(x)) : [],
    readyMs: numOrNull(row.readyMs),
    reviews: num(row.reviews),
    jobStatus: typeof row.jobStatus === "string" ? row.jobStatus : null,
    lastError: typeof row.lastError === "string" ? row.lastError : null,
  };
}

export async function runSmoke(o: SmokeOptions): Promise<SmokeResult> {
  const log = o.log ?? ((line) => process.stdout.write(`${JSON.stringify(line)}\n`));
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const fetchImpl = o.fetchImpl ?? fetch;
  const ref = o.ref ?? SMOKE_GAME_REF;
  const fail = (failures: string[], polls = 0, state: SmokeState | null = null): SmokeResult => {
    log({ step: "result", ok: false, failures });
    return { ok: false, polls, failures, state };
  };

  const [game] = await o.db.query(stmt(`SELECT id::text AS id, "plyCount" FROM games WHERE "referenceId" = $1`, [ref]));
  if (!game) return fail([`the smoke game ${ref} is not seeded (DB/seed/smoke.ts)`]);
  const gameId = idStr(game.id);
  await o.db.batch(resetStatements(gameId));
  log({ step: "reset", ref, plies: num(game.plyCount) });

  const [queued] = await o.db.query(
    fromPrisma(
      enqueueAnalysisSql({ gameId: BigInt(gameId), gameRef: ref, priority: JOB_PRIORITY.USER_OPENED, reason: "smoke" }),
    ),
  );
  if (!queued || queued.kept === true)
    return fail(["the smoke game could not be enqueued (not COMPLETED, or too short)"]);
  log({ step: "enqueued", jobId: idStr(queued.id) });

  // `runAt` = when the job is due (what every enqueuer passes), which also keeps two kicks in one second distinct for
  // the receiver's replay guard.
  const body = JSON.stringify({
    v: 1,
    reason: "smoke",
    watch: ref,
    runAt: new Date(num(queued.runAtMs)).toISOString(),
  });
  const kid = o.keys.keys.has(OPS_TO_WORKER_KID) ? OPS_TO_WORKER_KID : WEB_TO_WORKER_KID;
  const headers = signInternal({
    keys: o.keys,
    method: "POST",
    path: KICK_PATH,
    body,
    nowMs: (o.nowMs ?? Date.now)(),
    kid,
  });
  const res = await fetchImpl(`${o.workerUrl}${KICK_PATH}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(5_000),
  });
  await res.arrayBuffer().catch(() => undefined);
  log({ step: "kick", status: res.status, kid });
  if (res.status !== 202) return fail([`the kick answered ${res.status}`]);

  const maxPolls = o.maxPolls ?? SMOKE_MAX_POLLS;
  let state: SmokeState | null = null;
  for (let poll = 1; poll <= maxPolls; poll++) {
    await sleep(o.pollMs ?? SMOKE_POLL_MS);
    const [row] = await o.db.query(stateStatement(gameId));
    state = row ? toState(row) : null;
    log({ step: "poll", poll, status: state?.analysisStatus, graded: state?.gradedPlies, job: state?.jobStatus });
    if (!state) return fail(["the smoke game disappeared"], poll);
    if (state.analysisStatus === "DONE" || state.analysisStatus === "FAILED" || state.jobStatus === "FAILED") {
      const failures = smokeFailures(state);
      if (state.lastError && state.analysisStatus !== "DONE")
        failures.push(`job error: ${state.lastError.split(":")[0]}`);
      log({ step: "result", ok: failures.length === 0, failures, polls: poll });
      return { ok: failures.length === 0, polls: poll, failures, state };
    }
  }
  return fail([`not DONE after ${maxPolls} polls`], maxPolls, state);
}
