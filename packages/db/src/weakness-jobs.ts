// The RECOMPUTE_WEAKNESS enqueue SQL (phase-06 plan §7.4.1, §7.1.2 TR-12, §6.5 Q-W8 / Q-W12; interface check §0.4,
// §2 "DB/src/sql/enqueueWeakness.ts"), shared by the web (TR-12, the TR-5 kick CAS), the worker (the final analysis
// batch, the import finish, the first-build trigger, the daily slice) and the B-W3 script, so the coalescing rules
// live in one place:
//
//   enqueueWeaknessSql(input)          one member, the §7.4.1 upsert
//   enqueueWeaknessManySql(input)      the same upsert for every row of a subquery ("userId", trigger), as the body
//                                      of a caller's CTE (the daily slice, the final analysis batch)
//   requestRecomputeSql(input)         TR-12: the upsert behind the durable 1-per-600-s limit read from the member's
//                                      own job row (`payload.userAt`), and the scope write under the same predicate
//   weaknessKickCasSql(userId, now)    Q-W12: the compare-and-set before the web re-kicks the worker (≤ 1 per 30 s)
//
// ONE row per member, ever (`weaknessDedupeKey`). The conflict rules:
//   - QUEUED   keeps the earliest runAt (a long import never starves the recompute), takes the higher priority;
//   - RUNNING  is flagged `rerun: true` (the worker's completion re-queues it after the debounce: queue/outcome.ts
//              rerunIfFlaggedStatement) and keeps its run state;
//   - DONE / FAILED / CANCELLED are re-armed at max(runAt, finishedAt + debounce) as a fresh job (attempts 0, the run
//              state cleared, the new priority: a past USER_OPENED run does not pin the row at 100). `result` is KEPT
//              (FIX-1): it holds the last completion's token, so a worker whose batch response was lost still
//              recognises its committed completion (queue/outcome.ts outcomeByMeStatement) after an enqueue re-armed
//              the row in between; nothing reads `result` to decide what a queued row does.
// Every enqueue MERGES its payload into the row (`payload || new`), so the TR-12 `userAt` survives later triggers.
//
// Timestamps are `timestamp(3) without time zone` holding UTC: every expression writes `(now() AT TIME ZONE 'UTC')`
// and casts inputs as `($n::timestamptz AT TIME ZONE 'UTC')`. "maxAttempts" is written explicitly (the column default
// is 4, the kind's is 3). The payload is validated with the CT schema before it is written (this upsert bypasses
// enqueueJobSql's validation). Priorities are JOB_PRIORITY values only.
//
// `freezeSeeded` (the worker's WEAKNESS_SEED_FREEZE test hook, refused in production): a QUEUED row whose runAt is more
// than a year away (the `weakcompute` persona's seeded job) is left alone, so no worker trigger pulls it forward.
import { Prisma } from "#generated";
import { WEAKNESS_RECOMPUTE_WINDOW_SEC } from "@repo/contracts/http/weakness";
import {
  JOB_MAX_ATTEMPTS,
  JOB_PRIORITY,
  RecomputeWeaknessPayloadV1,
  WEAKNESS_TRIGGERS,
  weaknessDedupeKey,
  type JobPriority,
  type WeaknessTrigger,
} from "@repo/contracts/internal/jobs";

/** The coalescing window (§7.4.1): below Neon's 5-minute scale-to-zero, so the recompute rides the same wake. */
export const WEAKNESS_DEBOUNCE_SEC = 240;
/** WEAKNESS_DEBOUNCE_SEC must stay below Neon's suspend (300 s). */
export const WEAKNESS_DEBOUNCE_MAX_SEC = 299;
/** TR-12's durable limit: one user-requested recompute per this many seconds (CT WEAKNESS_RECOMPUTE_WINDOW_SEC). */
export const WEAKNESS_RECOMPUTE_LIMIT_SEC = WEAKNESS_RECOMPUTE_WINDOW_SEC;
/** A QUEUED row due later than this is a seeded fixture job (`freezeSeeded`). */
export const WEAKNESS_SEED_FREEZE_SEC = 365 * 86_400;
/** The TR-5 kick CAS: a QUEUED row this overdue may be re-kicked, at most once per this long (KICK_CAS_WINDOW_MS). */
export const WEAKNESS_KICK_CAS_SEC = 30;

const NOW_UTC = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
const PRIORITY_VALUES: ReadonlySet<number> = new Set(Object.values(JOB_PRIORITY));
const TIME_CLASSES_DB = ["BULLET", "BLITZ", "RAPID", "CLASSICAL"] as const;
const SCOPE_MONTHS = [3, 6, 12] as const;

export interface EnqueueWeaknessInput {
  userId: bigint;
  trigger: WeaknessTrigger;
  /** One of JOB_PRIORITY's values (§7.4.1 trigger table). */
  priority: JobPriority;
  /** Earliest start (already includes the trigger's delay, e.g. now + 240 s for `analysis`). */
  runAt: Date;
  /** A finished row is re-armed no earlier than its finishedAt + this many seconds (0..299). */
  debounceSec: number;
  /** TR-12: the request time, kept in the payload for the durable limit. */
  userAt?: Date;
  /** WEAKNESS_SEED_FREEZE: leave a seeded far-future QUEUED row alone. */
  freezeSeeded?: boolean;
}

function checkPriority(priority: number): void {
  if (!PRIORITY_VALUES.has(priority)) throw new Error(`weakness jobs: priority ${String(priority)} is not a JOB_PRIORITY value`);
}

function checkDebounce(sec: number, max: number = WEAKNESS_DEBOUNCE_MAX_SEC): void {
  if (!Number.isInteger(sec) || sec < 0 || sec > max) {
    throw new Error(`weakness jobs: debounceSec must be an integer within 0..${max}`);
  }
}

function utc(at: Date, what: string): Prisma.Sql {
  if (Number.isNaN(at.getTime())) throw new Error(`weakness jobs: ${what} is an invalid Date`);
  return Prisma.sql`(${at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/** The validated payload of one enqueue (`{v:1, trigger, userAt?}`). */
export function weaknessPayload(trigger: WeaknessTrigger, userAt?: Date): RecomputeWeaknessPayloadV1 {
  return RecomputeWeaknessPayloadV1.parse({ v: 1, trigger, ...(userAt ? { userAt: userAt.toISOString() } : {}) });
}

/**
 * The §7.4.1 conflict clause (see the header) with its RETURNING list: `id`, `status`, `runAtMs`, `created` (this
 * statement inserted the row), `rerun` (the row is RUNNING and now flagged).
 */
function conflictClause(debounceSec: number, freezeSeeded: boolean, extraWhere: Prisma.Sql | null): Prisma.Sql {
  const running = Prisma.sql`jobs.status = 'RUNNING'`;
  const keep = (col: string) => Prisma.sql`${Prisma.raw(`"${col}"`)} = CASE WHEN ${running} THEN jobs.${Prisma.raw(`"${col}"`)} END`;
  const guards: Prisma.Sql[] = [];
  if (freezeSeeded) {
    guards.push(
      Prisma.sql`NOT (jobs.status = 'QUEUED' AND jobs."runAt" > ${NOW_UTC} + make_interval(secs => ${WEAKNESS_SEED_FREEZE_SEC}::int))`,
    );
  }
  if (extraWhere) guards.push(extraWhere);
  return Prisma.sql`ON CONFLICT ("dedupeKey") DO UPDATE SET
    payload       = CASE WHEN ${running} THEN jobs.payload || EXCLUDED.payload || '{"rerun":true}'::jsonb
                         ELSE (jobs.payload - 'rerun') || EXCLUDED.payload END,
    status        = CASE WHEN ${running} THEN jobs.status ELSE 'QUEUED'::"JobStatus" END,
    "runAt"       = CASE WHEN ${running} THEN jobs."runAt"
                         WHEN jobs.status = 'QUEUED' THEN LEAST(jobs."runAt", EXCLUDED."runAt")
                         ELSE GREATEST(EXCLUDED."runAt",
                                       COALESCE(jobs."finishedAt", ${NOW_UTC}) + make_interval(secs => ${debounceSec}::int)) END,
    priority      = CASE WHEN jobs.status IN ('QUEUED', 'RUNNING') THEN GREATEST(jobs.priority, EXCLUDED.priority)
                         ELSE EXCLUDED.priority END,
    attempts      = CASE WHEN ${running} THEN jobs.attempts ELSE 0 END,
    "maxAttempts" = CASE WHEN ${running} THEN jobs."maxAttempts" ELSE EXCLUDED."maxAttempts" END,
    ${keep("lastError")}, ${keep("finishedAt")}, ${keep("lockedBy")}, ${keep("lockedAt")}, ${keep("heartbeatAt")},
    ${keep("startedAt")}, result = jobs.result
  ${guards.length ? Prisma.sql`WHERE ${Prisma.join(guards, " AND ")}` : Prisma.empty}
  RETURNING id, "userId", status::text AS status, (extract(epoch FROM "runAt") * 1000)::float8 AS "runAtMs",
            (xmax = 0) AS created, COALESCE(payload->>'rerun' = 'true', false) AS rerun`;
}

/** The §7.4.1 upsert for one member. RETURNING: id, userId, status, runAtMs, created, rerun (0 rows: frozen). */
export function enqueueWeaknessSql(i: EnqueueWeaknessInput): Prisma.Sql {
  checkPriority(i.priority);
  checkDebounce(i.debounceSec);
  const payload = weaknessPayload(i.trigger, i.userAt);
  return Prisma.sql`INSERT INTO jobs (kind, "dedupeKey", "userId", priority, "fairSeq", "runAt", payload, status, attempts,
                  "maxAttempts", "createdAt")
  VALUES ('RECOMPUTE_WEAKNESS', ${weaknessDedupeKey(i.userId)}, ${i.userId}::bigint, ${i.priority}::smallint, 0,
          ${utc(i.runAt, "runAt")}, ${JSON.stringify(payload)}::jsonb, 'QUEUED', 0,
          ${JOB_MAX_ATTEMPTS.RECOMPUTE_WEAKNESS}::smallint, ${NOW_UTC})
  ${conflictClause(i.debounceSec, i.freezeSeeded === true, null)}`;
}

export interface EnqueueWeaknessManyInput {
  /**
   * A subquery with the columns `"userId"` (bigint) and `trigger` (text, a WEAKNESS_TRIGGERS value; a row with any
   * other trigger is not enqueued). Distinct users only (ON CONFLICT cannot touch one row twice). A string is a
   * parameter-free subquery (callers without a Prisma import, e.g. the worker, embed only validated integers in it).
   */
  rows: Prisma.Sql | string;
  priority: JobPriority;
  /** null = the database clock's now + `delaySec`. */
  runAt: Date | null;
  /** With `runAt` null: seconds after the database's now (default 0). */
  delaySec?: number;
  debounceSec: number;
  freezeSeeded?: boolean;
  /**
   * FIX-2: a QUEUED or RUNNING row is left exactly as it is (never pulled forward, never flagged to run again): the run
   * already pending reads the change. The
   * web's `removed` arm uses it with a debounce of RECOMPUTE_LIMIT_SEC, so a member cannot force recomputes faster than
   * TR-12's limit by hiding and un-hiding mistakes (D-P6-FIX2-15).
   */
  leaveActive?: boolean;
}

/**
 * The §7.4.1 upsert for every row of `rows`, as ONE `INSERT … SELECT … ON CONFLICT … RETURNING` (no CTE of its own, so
 * it can be a caller's CTE body). The payload schema cannot run per row in SQL, so the trigger is checked against
 * WEAKNESS_TRIGGERS there: a row with another trigger is skipped.
 */
export function enqueueWeaknessManySql(i: EnqueueWeaknessManyInput): Prisma.Sql {
  checkPriority(i.priority);
  checkDebounce(i.debounceSec, i.leaveActive ? WEAKNESS_RECOMPUTE_LIMIT_SEC : WEAKNESS_DEBOUNCE_MAX_SEC);
  const delay = i.delaySec ?? 0;
  if (!Number.isInteger(delay) || delay < 0 || delay > 86_400) throw new Error("weakness jobs: delaySec must be an integer within 0..86400");
  const runAt = i.runAt ? utc(i.runAt, "runAt") : Prisma.sql`(${NOW_UTC} + make_interval(secs => ${delay}::int))`;
  return Prisma.sql`INSERT INTO jobs (kind, "dedupeKey", "userId", priority, "fairSeq", "runAt", payload, status, attempts,
                  "maxAttempts", "createdAt")
  SELECT 'RECOMPUTE_WEAKNESS', 'weakness:' || r."userId"::text, r."userId", ${i.priority}::smallint, 0, ${runAt},
         jsonb_build_object('v', 1, 'trigger', r.trigger::text),
         'QUEUED', 0, ${JOB_MAX_ATTEMPTS.RECOMPUTE_WEAKNESS}::smallint, ${NOW_UTC}
    FROM (${typeof i.rows === "string" ? Prisma.raw(i.rows) : i.rows}) AS r("userId", trigger)
   WHERE r.trigger::text = ANY(${[...WEAKNESS_TRIGGERS]}::text[])
  ${conflictClause(i.debounceSec, i.freezeSeeded === true, i.leaveActive ? Prisma.sql`jobs.status NOT IN ('QUEUED', 'RUNNING')` : null)}`;
}

/** A parameter-free `bigint[]` literal of user ids (each checked to be an id), for `rows` subqueries. */
export function userIdsLiteral(userIds: readonly (string | bigint)[]): string {
  const ids = userIds.map((u) => String(u));
  for (const id of ids) if (!/^[1-9][0-9]{0,18}$/.test(id)) throw new Error(`weakness jobs: "${id}" is not a user id`);
  return `ARRAY[${ids.join(", ")}]::bigint[]`;
}

/** TR-12's scope change (§7.1.2 side effect 1), sorted into the enum order. */
export interface RecomputeScope {
  timeClasses: readonly string[];
  months: number;
}

function normaliseScope(scope: RecomputeScope): { timeClasses: string[]; months: number } {
  const set = new Set(scope.timeClasses);
  const timeClasses = TIME_CLASSES_DB.filter((tc) => set.has(tc));
  if (timeClasses.length === 0 || timeClasses.length !== set.size) throw new Error("weakness jobs: scope.timeClasses must be 1..4 of BULLET, BLITZ, RAPID, CLASSICAL");
  if (!(SCOPE_MONTHS as readonly number[]).includes(scope.months)) throw new Error("weakness jobs: scope.months must be 3, 6 or 12");
  return { timeClasses, months: scope.months };
}

export interface RequestRecomputeInput extends Omit<EnqueueWeaknessInput, "userAt" | "freezeSeeded"> {
  /** The request clock (`ctx.now`; `x-rc-now` moves it in tests). The payload's `userAt` is this instant. */
  now: Date;
  /** When given, `training_profiles` takes this scope (upserted) under the same limit predicate. */
  scope?: RecomputeScope;
}

/**
 * TR-12 (§7.1.2, AP-11 option b) as ONE statement. Its single row:
 *   - `queued` (int): 1 when the job was armed, 0 when the durable limit refused it (→ 429);
 *   - `prevUserAtMs` (float8 | null): the previous request's instant (retryAfterSec = ceil(600 − (now − prev)/1000));
 *   - `scopeChanged` (boolean): the scope row was inserted or changed (always false when refused or no scope given);
 *   - `runAtMs` (float8 | null): the armed job's runAt.
 * The `DO UPDATE … WHERE` re-checks the locked row, so two concurrent requests give exactly one `queued = 1`. The scope
 * is written only when this statement armed the job (`EXISTS (SELECT 1 FROM up)`), so a 429, or the loser of two
 * concurrent requests, never changes the scope.
 */
export function requestRecomputeSql(i: RequestRecomputeInput): Prisma.Sql {
  checkPriority(i.priority);
  checkDebounce(i.debounceSec);
  const payload = weaknessPayload(i.trigger, i.now);
  const key = weaknessDedupeKey(i.userId);
  const now = Prisma.sql`${i.now.toISOString()}::timestamptz`;
  const windowStart = Prisma.sql`(${now} - make_interval(secs => ${WEAKNESS_RECOMPUTE_LIMIT_SEC}::int))`;
  const scope = i.scope ? normaliseScope(i.scope) : null;
  const scopeCte = scope
    ? Prisma.sql`, sc AS (
  INSERT INTO training_profiles ("userId", "weaknessTimeClasses", "weaknessMonths", "updatedAt")
  SELECT ${i.userId}::bigint, ${scope.timeClasses}::"TimeClass"[], ${scope.months}::smallint, ${NOW_UTC}
   WHERE EXISTS (SELECT 1 FROM up)
  ON CONFLICT ("userId") DO UPDATE
     SET "weaknessTimeClasses" = EXCLUDED."weaknessTimeClasses", "weaknessMonths" = EXCLUDED."weaknessMonths",
         "updatedAt" = EXCLUDED."updatedAt"
   WHERE (training_profiles."weaknessTimeClasses", training_profiles."weaknessMonths")
         IS DISTINCT FROM (EXCLUDED."weaknessTimeClasses", EXCLUDED."weaknessMonths")
  RETURNING 1
)`
    : Prisma.empty;
  return Prisma.sql`WITH prev AS (
  SELECT (payload->>'userAt')::timestamptz AS "userAt" FROM jobs WHERE "dedupeKey" = ${key}
), lim AS (
  SELECT NOT EXISTS (SELECT 1 FROM prev WHERE "userAt" > ${windowStart}) AS ok
), up AS (
  INSERT INTO jobs (kind, "dedupeKey", "userId", priority, "fairSeq", "runAt", payload, status, attempts, "maxAttempts",
                    "createdAt")
  SELECT 'RECOMPUTE_WEAKNESS', ${key}, ${i.userId}::bigint, ${i.priority}::smallint, 0, ${utc(i.runAt, "runAt")},
         ${JSON.stringify(payload)}::jsonb, 'QUEUED', 0, ${JOB_MAX_ATTEMPTS.RECOMPUTE_WEAKNESS}::smallint, ${NOW_UTC}
   WHERE (SELECT ok FROM lim)
  ${conflictClause(
    i.debounceSec,
    false,
    Prisma.sql`COALESCE((jobs.payload->>'userAt')::timestamptz, '-infinity'::timestamptz) <= ${windowStart}`,
  )}
)${scopeCte}
SELECT (SELECT count(*) FROM up)::int AS queued,
       (extract(epoch FROM (SELECT "userAt" FROM prev)) * 1000)::float8 AS "prevUserAtMs",
       ${scope ? Prisma.sql`(SELECT count(*) FROM sc) > 0` : Prisma.sql`false`} AS "scopeChanged",
       (SELECT "runAtMs" FROM up) AS "runAtMs"`;
}

/** Seconds until TR-12 may run again (the 429's retryAfterSec), from the previous request's instant. */
export function recomputeRetryAfterSec(prevUserAtMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil(WEAKNESS_RECOMPUTE_LIMIT_SEC - (nowMs - prevUserAtMs) / 1000));
}

/**
 * Q-W12 (§7.1.1 step 7): stamps `lastKickAt` on the member's QUEUED row when it is at least 30 s overdue and was not
 * kicked in the last 30 s. One row back = the caller kicks the worker; none = someone else did, or nothing is due.
 */
export function weaknessKickCasSql(userId: bigint, now: Date): Prisma.Sql {
  const at = utc(now, "now");
  return Prisma.sql`UPDATE jobs SET "lastKickAt" = ${at}
   WHERE "dedupeKey" = ${weaknessDedupeKey(userId)} AND status = 'QUEUED'
     AND "runAt" < ${at} - make_interval(secs => ${WEAKNESS_KICK_CAS_SEC}::int)
     AND ("lastKickAt" IS NULL OR "lastKickAt" < ${at} - make_interval(secs => ${WEAKNESS_KICK_CAS_SEC}::int))
  RETURNING id`;
}

/**
 * FIX-1, trigger `removed`: rows the profile was computed from are gone (an IMPORT_PURGE batch) or a bank card was
 * removed (its mistake hidden), so the counts and the example positions may be stale. Arms the member's row now
 * (debounce 0) when the member has a snapshot (`readyOnly`: a READY one, the hide path: only a READY profile shows
 * examples). Parameter-free apart from the user id; the worker embeds it through `userIdsLiteral`.
 */
export function weaknessRemovedSql(
  userId: bigint | string,
  opts: { readyOnly: boolean; freezeSeeded?: boolean; debounceSec?: number; leaveActive?: boolean },
): Prisma.Sql {
  const status = opts.readyOnly ? ` AND ws.status = 'READY'` : "";
  return enqueueWeaknessManySql({
    rows: `SELECT x.u, 'removed'::text FROM unnest(${userIdsLiteral([String(userId)])}) AS x(u)
            WHERE EXISTS (SELECT 1 FROM weakness_snapshots ws WHERE ws."userId" = x.u${status})`,
    priority: JOB_PRIORITY.WEAKNESS,
    runAt: null,
    delaySec: 0,
    debounceSec: opts.debounceSec ?? 0,
    ...(opts.freezeSeeded ? { freezeSeeded: true } : {}),
    ...(opts.leaveActive ? { leaveActive: true } : {}),
  });
}

/**
 * FIX-2 (D-P6-FIX2-15): the web's `removed` arm (a bank card removed, its mistake newly hidden). Never faster than
 * TR-12's durable limit: a finished row re-arms at the earliest `finishedAt + WEAKNESS_RECOMPUTE_LIMIT_SEC`; a queued or
 * running one is left alone (no pull forward, no rerun flag).
 */
export function weaknessHiddenSql(userId: bigint | string): Prisma.Sql {
  return weaknessRemovedSql(userId, { readyOnly: true, debounceSec: WEAKNESS_RECOMPUTE_LIMIT_SEC, leaveActive: true });
}

/**
 * P6 FIX-2 (docs/decisions.md D-P6-FIX2-8): one `weakness_lines` ANALYZE_GAME row per game (dedupe key
 * `weaklines:<gameId>`, HOUSEKEEPING priority, no userId, so no member's probe counts it as analysis work): the worker
 * searches the member errors' lines and refutations of the finished analysis and rewrites the five weakness input
 * columns, nothing else. A finished row is revived; a pending one is left as it is. RETURNING the armed count.
 * Shared by the recompute's heal (worker) and B-W1 (web script).
 */
export function weaknessLinesSql(games: readonly { gameId: bigint | string; gameRef: string }[]): Prisma.Sql {
  for (const g of games) if (!/^[1-9][0-9]{0,18}$/.test(String(g.gameId))) throw new Error(`weakness jobs: "${String(g.gameId)}" is not a game id`);
  const doc = JSON.stringify(games.map((g) => ({ g: String(g.gameId), r: g.gameRef })));
  return Prisma.sql`WITH v AS (
  SELECT x.g::bigint AS "gameId", x.r AS ref FROM jsonb_to_recordset(${doc}::jsonb) AS x(g text, r text)
), up AS (
  INSERT INTO jobs (kind, "dedupeKey", "gameId", priority, "fairSeq", payload, "runAt", status, attempts, "maxAttempts", "createdAt")
  SELECT 'ANALYZE_GAME', 'weaklines:' || v."gameId"::text, v."gameId", ${JOB_PRIORITY.HOUSEKEEPING}::smallint, 0,
         jsonb_build_object('v', 1, 'gameId', v."gameId"::text, 'gameRef', v.ref, 'reason', 'weakness_lines'),
         ${NOW_UTC}, 'QUEUED', 0, ${JOB_MAX_ATTEMPTS.ANALYZE_GAME}::smallint, ${NOW_UTC}
    FROM v
  ON CONFLICT ("dedupeKey") DO UPDATE SET
    status = 'QUEUED', "runAt" = EXCLUDED."runAt", attempts = 0, payload = EXCLUDED.payload, priority = EXCLUDED.priority,
    "lockedBy" = NULL, "lockedAt" = NULL, "heartbeatAt" = NULL, "lastError" = NULL, "startedAt" = NULL, "finishedAt" = NULL,
    result = NULL
  WHERE jobs.status IN ('DONE', 'FAILED', 'CANCELLED')
  RETURNING 1
)
SELECT count(*)::int AS armed FROM up`;
}
