// The analysis backlog release for imported games (phase-04 plan 8.9, 8.5.4 step 4; D4-09, D4-27). Shared by the web
// (the entitlement fan-out on a member's first paid period, and `payment.succeeded` with an amount) and the worker
// (right after a paying member's INITIAL run), so both run the same statement:
//
//   releaseImportBacklogSql(input) → Prisma.Sql   (the worker sends `sql.text` / `sql.values` over the HTTP driver)
//   releaseImportBacklog(db, input)                (any Prisma client, transaction client or SqlClient)
//
// ONE statement: it picks the member's imported games (game_players.source <> 'REPLAY') whose analysis was never
// queued (games."analysisStatus" = 'NONE', COMPLETED, ≥ ANALYSIS_MIN_PLIES plies), newest first, up to the room left
// in the member's budget (cap − already analysed or queued imported games), and inserts ANALYZE_GAME jobs at
// JOB_PRIORITY.BACKLOG with fairSeq = rank, split into `spreadDays` equal slices (ntile). Slice k runs at
// `base + k days`, where `base` is the member's daily-sync slot: the earliest future "nextAutoSyncAt" of an ACTIVE
// auto-import link, else the same rule computed in SQL from users."timeZone" (CT/internal/import-schedule.ts
// backlogSlotAt: next local 03:00 + userId % 60 min, snapped to HH:05 UTC). A slice of ≈ 26 games then shares the one
// Neon wake of that hour with the daily sync. The chosen games flip to QUEUED and their members' gamesVersion is
// bumped (the archive ETag), in the same statement.
//
// Idempotent: a second call finds no NONE game inside the budget and inserts nothing (and `ON CONFLICT ("dedupeKey")
// DO NOTHING` covers a game that already has a job). So a caller whose HTTP driver lost the response after the commit
// simply sends it again; the retry answers `queued: 0`, which is correct (the first call's jobs exist).
import { Prisma } from "#generated";
import { ANALYSIS_MIN_PLIES, JOB_MAX_ATTEMPTS, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import type { SqlClient } from "./live/types";

/** IMPORT_ANALYSE_CAP default (D4-09): imported games analysed without being opened, per member, both providers. */
export const IMPORT_ANALYSE_CAP_DEFAULT = 200;
/** IMPORT_BACKLOG_SPREAD_DAYS default (D4-09). */
export const IMPORT_BACKLOG_SPREAD_DAYS_DEFAULT = 7;

export interface ReleaseImportBacklogInput {
  userId: bigint;
  /** The request / job clock; default the database's now(). */
  now?: Date;
  /** IMPORT_ANALYSE_CAP. */
  cap?: number;
  /** IMPORT_BACKLOG_SPREAD_DAYS. */
  spreadDays?: number;
}

export interface BacklogRelease {
  /** ANALYZE_GAME jobs this call inserted (0 on a repeat). */
  queued: number;
  /** One entry per slice, by runAt. */
  slots: { runAt: Date; games: number }[];
}

function positiveInt(name: string, value: number, max: number): number {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`import-backlog: ${name} must be an integer 1..${max}`);
  return value;
}

/** Reads IMPORT_ANALYSE_CAP / IMPORT_BACKLOG_SPREAD_DAYS from an env object (defaults when unset or invalid). */
export function backlogSettingsFromEnv(env: Record<string, string | undefined> = process.env): { cap: number; spreadDays: number } {
  const num = (raw: string | undefined, def: number, max: number) => {
    const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= max ? n : def;
  };
  return {
    cap: num(env.IMPORT_ANALYSE_CAP, IMPORT_ANALYSE_CAP_DEFAULT, 10_000),
    spreadDays: num(env.IMPORT_BACKLOG_SPREAD_DAYS, IMPORT_BACKLOG_SPREAD_DAYS_DEFAULT, 60),
  };
}

export function releaseImportBacklogSql(input: ReleaseImportBacklogInput): Prisma.Sql {
  const cap = positiveInt("cap", input.cap ?? IMPORT_ANALYSE_CAP_DEFAULT, 10_000);
  const days = positiveInt("spreadDays", input.spreadDays ?? IMPORT_BACKLOG_SPREAD_DAYS_DEFAULT, 60);
  if (input.now && Number.isNaN(input.now.getTime())) throw new Error("import-backlog: now is an invalid Date");
  const uid = input.userId;
  const nowTz = input.now ? Prisma.sql`${input.now.toISOString()}::timestamptz` : Prisma.sql`now()`;
  return Prisma.sql`WITH clock AS (
  SELECT ${nowTz} AS now_tz
), me AS (
  -- An unknown zone (not in this server's tz database) falls back to UTC instead of failing the release.
  SELECT u.id,
         CASE WHEN u."timeZone" = 'UTC' OR EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = u."timeZone")
              THEN u."timeZone" ELSE 'UTC' END AS tz
    FROM users u WHERE u.id = ${uid}
), used AS (
  SELECT count(*)::int AS n
    FROM game_players gp JOIN games g ON g.id = gp."gameId"
   WHERE gp."userId" = ${uid} AND gp.source <> 'REPLAY' AND g."analysisStatus" <> 'NONE'
), cand AS (
  SELECT g.id, g."referenceId",
         row_number() OVER (ORDER BY gp."endedAt" DESC NULLS LAST, g.id DESC)::int AS rank
    FROM game_players gp JOIN games g ON g.id = gp."gameId"
   WHERE gp."userId" = ${uid} AND gp.source <> 'REPLAY' AND g."analysisStatus" = 'NONE'
     AND g.status = 'COMPLETED' AND g."plyCount" >= ${ANALYSIS_MIN_PLIES}
   ORDER BY gp."endedAt" DESC NULLS LAST, g.id DESC
   LIMIT GREATEST(0, ${cap}::int - (SELECT n FROM used))
), local3 AS (
  SELECT (date_trunc('day', c.now_tz AT TIME ZONE me.tz) + interval '3 hours') AT TIME ZONE me.tz AS today,
         (date_trunc('day', c.now_tz AT TIME ZONE me.tz) + interval '1 day 3 hours') AT TIME ZONE me.tz AS tomorrow,
         c.now_tz
    FROM clock c CROSS JOIN me
), slot AS (
  SELECT COALESCE(
           (SELECT min(la."nextAutoSyncAt") FROM linked_accounts la
             WHERE la."userId" = ${uid} AND la."autoImport" AND la.status = 'ACTIVE'
               AND la."nextAutoSyncAt" > (l.now_tz AT TIME ZONE 'UTC')),
           date_trunc('hour', ((CASE WHEN l.today > l.now_tz THEN l.today ELSE l.tomorrow END) AT TIME ZONE 'UTC')
                              + make_interval(mins => (${uid}::bigint % 60)::int))
             + interval '5 minutes'
         ) AS base
    FROM local3 l
), sliced AS (
  SELECT c.id, c."referenceId", c.rank, (ntile(${days}::int) OVER (ORDER BY c.rank) - 1) AS k FROM cand c
), j AS (
  INSERT INTO jobs (kind, priority, "fairSeq", "dedupeKey", "userId", "gameId", payload, "runAt", "maxAttempts")
  SELECT 'ANALYZE_GAME'::"JobKind", ${JOB_PRIORITY.BACKLOG}::smallint, s.rank, 'analyze:' || s.id, ${uid}::bigint, s.id,
         jsonb_build_object('v', 1, 'gameId', s.id::text, 'gameRef', s."referenceId", 'reason', 'import'),
         slot.base + make_interval(days => s.k::int), ${JOB_MAX_ATTEMPTS.ANALYZE_GAME}::smallint
    FROM sliced s CROSS JOIN slot
  ON CONFLICT ("dedupeKey") DO NOTHING
  RETURNING "gameId", "runAt"
), g AS (
  UPDATE games SET "analysisStatus" = 'QUEUED'
   WHERE id IN (SELECT "gameId" FROM j) AND "analysisStatus" = 'NONE'
  RETURNING id
), v AS (
  UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1
   WHERE u.id IN (SELECT gp."userId" FROM game_players gp WHERE gp."gameId" IN (SELECT id FROM g))
  RETURNING u.id
)
SELECT (extract(epoch FROM j."runAt") * 1000)::float8 AS "runAtMs", count(*)::int AS games,
       (SELECT count(*) FROM v)::int AS bumped
  FROM j
 GROUP BY j."runAt"
 ORDER BY j."runAt"`;
}

interface SlotRow {
  runAtMs: number | string;
  games: number | string;
}

export function toBacklogRelease(rows: SlotRow[]): BacklogRelease {
  const slots = rows.map((r) => ({ runAt: new Date(Math.round(Number(r.runAtMs))), games: Number(r.games) }));
  return { queued: slots.reduce((n, s) => n + s.games, 0), slots };
}

export async function releaseImportBacklog(db: SqlClient, input: ReleaseImportBacklogInput): Promise<BacklogRelease> {
  const rows = await db.$queryRaw<SlotRow[]>(releaseImportBacklogSql(input));
  return toBacklogRelease(rows);
}
