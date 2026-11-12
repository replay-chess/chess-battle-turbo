// Shared setup for the worker's `*.int.test.ts` files: a real Postgres after `prisma migrate deploy` (CI's service
// container or a local Docker Postgres). Skipped unless TEST_DATABASE_URL is set; refuses any non-local host.
//
// The claim and the reaper take ANY due/stalled row, HOUSEKEEPING prunes ANY expired share or limiter row and its
// regrade sweep reads ANY outdated analysis, while other suites (packages/db's jobs.int and seeds.int, the other worker
// files) write those tables at the same time. So each test file gets its own copies of `jobs`, `shares`,
// `rate_limit_buckets`, `rate_limit_windows` and `game_analyses` in a private schema (`CREATE TABLE … (LIKE public.x
// INCLUDING ALL)`: same columns, defaults, partial indexes, unique keys; no foreign keys), and the worker connects with
// `search_path = <that schema>, public`: those five are private, everything else (games, users, game_players,
// player_reviews, legend_comparisons, the enums) is the real public table.
//
// With TEST_WORKER_DATABASE_URL (role `replay_worker` after packages/db/scripts/roles/replay_worker.sql) the worker's
// statements run as that role, which proves its grants on every table except the private `jobs` copy (granted here
// exactly as replay_worker.sql grants the public tables).
import { randomBytes } from "node:crypto";
import pg from "pg";
import { CountingDb, pgDriver } from "../db/client";

export const TEST_URL = process.env.TEST_DATABASE_URL;
export const WORKER_URL = process.env.TEST_WORKER_DATABASE_URL ?? TEST_URL;
export const skipInt = TEST_URL ? false : "TEST_DATABASE_URL not set";

export function assertLocalTestUrl(url: string): void {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host)) {
    throw new Error(`refusing to run the worker integration tests against ${host}: use a local Postgres`);
  }
}

export const run = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;

/** The tables each int-test file gets its own copy of, with the grants replay_worker.sql gives the public ones. */
export const PRIVATE_TABLES = {
  jobs: "SELECT, INSERT, UPDATE, DELETE",
  game_analyses: "SELECT, INSERT, UPDATE, DELETE",
  shares: `SELECT (id, code, kind, "expiresAt", "revokedAt"), DELETE`,
  rate_limit_buckets: "SELECT, DELETE",
  rate_limit_windows: "SELECT, DELETE",
} as const;

export interface IntEnv {
  owner: pg.Pool;
  /** The worker's client (role replay_worker when TEST_WORKER_DATABASE_URL is set), jobs isolated. */
  db: CountingDb;
  /** The same connection string as `db`, for a second worker. */
  workerUrl: string;
  schema: string;
  close(): Promise<void>;
}

export async function setupInt(label: string): Promise<IntEnv> {
  assertLocalTestUrl(TEST_URL!);
  assertLocalTestUrl(WORKER_URL!);
  const owner = new pg.Pool({ connectionString: TEST_URL, max: 4 });
  const schema = `wk_${label}_${run}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 60);
  await owner.query(`CREATE SCHEMA ${schema}`);
  for (const table of Object.keys(PRIVATE_TABLES)) {
    await owner.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  const worker = new URL(WORKER_URL!).username;
  if (worker !== new URL(TEST_URL!).username) {
    await owner.query(`GRANT USAGE ON SCHEMA ${schema} TO "${worker}"`);
    for (const [table, grants] of Object.entries(PRIVATE_TABLES)) {
      await owner.query(`GRANT ${grants} ON ${schema}.${table} TO "${worker}"`);
    }
  }
  const url = new URL(WORKER_URL!);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  const workerUrl = url.toString();
  const db = new CountingDb(pgDriver(workerUrl));
  return {
    owner,
    db,
    workerUrl,
    schema,
    async close() {
      await db.close();
      await owner.query(`DROP SCHEMA ${schema} CASCADE`);
      await owner.end();
    },
  };
}

// ── fixtures (written as the owner: the worker role cannot insert games or users) ────────────────────────────────
let n = 0;
const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export interface TestUser {
  id: string;
  ref: string;
}

export async function makeUser(owner: pg.Pool, label: string): Promise<TestUser> {
  n++;
  const ref = `cw${run}${String(n).padStart(4, "0")}`.slice(0, 26).padEnd(21, "0");
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO users ("referenceId", code, "googleId", email, name, "updatedAt")
     VALUES ($1, $2, $3, $4, $5, now()) RETURNING id::text AS id`,
    [ref, `code-${run}-${n}`, `google-${run}-${n}`, `${label}-${run}-${n}@test.invalid`, `${label}_${n}`.slice(0, 40)],
  );
  return { id: rows[0]!.id, ref };
}

export interface TestGame {
  id: string;
  ref: string;
}

export async function makeGame(
  owner: pg.Pool,
  white: TestUser,
  black: TestUser,
  opts: { plyCount?: number; analysisStatus?: string } = {},
): Promise<TestGame> {
  n++;
  const ref = `cg${run}${String(n).padStart(4, "0")}`.slice(0, 26).padEnd(21, "0");
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO games ("referenceId", "creatorId", "opponentId", status, "startingFen", "initialTimeSeconds",
                        "incrementSeconds", "creatorTimeRemaining", "opponentTimeRemaining", "expiresAt", "updatedAt",
                        mode, "whitePlayerId", "blackPlayerId", "plyCount", "analysisStatus", "completedAt")
     VALUES ($1, $2, $3, 'COMPLETED', $4, 300, 0, 300, 300, now() + interval '1 day', now(),
             'FRIEND', $2, $3, $5, $6::"AnalysisStatus", now())
     RETURNING id::text AS id`,
    [ref, white.id, black.id, INITIAL_FEN, opts.plyCount ?? 40, opts.analysisStatus ?? "RUNNING"],
  );
  const id = rows[0]!.id;
  for (const [color, user] of [
    ["w", white],
    ["b", black],
  ] as const) {
    await owner.query(
      `INSERT INTO game_players ("gameId", "userId", color, mode, "updatedAt") VALUES ($1, $2, $3, 'FRIEND', now())`,
      [id, user.id, color],
    );
  }
  return { id, ref };
}

export interface JobInput {
  kind?: string;
  status?: string;
  priority?: number;
  fairSeq?: number;
  /** Seconds relative to now (negative = in the past). */
  runAtSec?: number;
  payload?: unknown;
  dedupeKey?: string | null;
  gameId?: string | null;
  attempts?: number;
  maxAttempts?: number;
  lockedBy?: string | null;
  /** Seconds relative to now. */
  heartbeatSec?: number | null;
}

export async function insertJob(env: IntEnv, j: JobInput = {}): Promise<string> {
  const { rows } = await env.owner.query<{ id: string }>(
    `INSERT INTO ${env.schema}.jobs (kind, status, priority, "fairSeq", "runAt", payload, "dedupeKey", "gameId", attempts,
                                     "maxAttempts", "lockedBy", "lockedAt", "heartbeatAt", "startedAt")
     VALUES ($1::"JobKind", $2::"JobStatus", $3, $4, (now() AT TIME ZONE 'UTC') + ($5::int * interval '1 second'), $6::jsonb,
             $7, $8::bigint, $9, $10, $11::varchar(40),
             CASE WHEN $11::varchar(40) IS NULL THEN NULL ELSE (now() AT TIME ZONE 'UTC') END,
             CASE WHEN $12::int IS NULL THEN NULL ELSE (now() AT TIME ZONE 'UTC') + ($12::int * interval '1 second') END,
             CASE WHEN $2 = 'RUNNING' THEN (now() AT TIME ZONE 'UTC') END)
     RETURNING id::text AS id`,
    [
      j.kind ?? "ANALYZE_GAME",
      j.status ?? "QUEUED",
      j.priority ?? 80,
      j.fairSeq ?? 0,
      j.runAtSec ?? -1,
      JSON.stringify(j.payload ?? { v: 1, gameId: "1", gameRef: "c0000000000000000000000", reason: "live_end" }),
      j.dedupeKey === undefined ? `t:${run}:${++n}` : j.dedupeKey,
      j.gameId ?? null,
      j.attempts ?? 0,
      j.maxAttempts ?? 4,
      j.lockedBy ?? null,
      j.heartbeatSec === undefined ? null : j.heartbeatSec,
    ],
  );
  return rows[0]!.id;
}

export async function jobRow(env: IntEnv, id: string) {
  const { rows } = await env.owner.query(
    `SELECT id::text AS id, kind::text AS kind, status::text AS status, priority, attempts, "maxAttempts", "lockedBy",
            "lastError", result, payload, "dedupeKey",
            (extract(epoch FROM "runAt") * 1000)::float8 AS "runAtMs",
            (extract(epoch FROM "heartbeatAt") * 1000)::float8 AS "heartbeatAtMs",
            (extract(epoch FROM "finishedAt") * 1000)::float8 AS "finishedAtMs",
            (extract(epoch FROM (now() AT TIME ZONE 'UTC')) * 1000)::float8 AS "nowMs"
       FROM ${env.schema}.jobs WHERE id = $1`,
    [id],
  );
  return rows[0] as {
    id: string;
    kind: string;
    status: string;
    priority: number;
    attempts: number;
    maxAttempts: number;
    lockedBy: string | null;
    lastError: string | null;
    result: unknown;
    payload: unknown;
    dedupeKey: string | null;
    runAtMs: number;
    heartbeatAtMs: number | null;
    finishedAtMs: number | null;
    nowMs: number;
  };
}
