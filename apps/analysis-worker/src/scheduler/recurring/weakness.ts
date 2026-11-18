// HOUSEKEEPING slice (phase-06 plan §7.4.6, §7.4.7; interface check §0.10): the Weakness Profile's daily work, three
// set-based statements in HOUSEKEEPING's ONE batch (no HOURLY_TICK, no timer: the 21:00 UTC wake that already happens;
// the timer audit stays green), each capped so a day's work stays far below the role's statement timeout:
//
//   1. weekly roll: members (entitled, the web's rules: an admin, `active`, a scheduled cancel or a grace status still
//      inside the paid period) whose newest snapshot's `weekStart` is before the Monday of their CURRENT local week
//      (`date_trunc('week', …)` in `User.timeZone`: the same Monday as TRN weekStartOf) and who trained or played in the
//      last 30 days (`training_attempts_userId_reviewedAt_idx`, `game_players_userId_endedAt_gameId_idx`, one LIMIT 1
//      probe each) → `weekly` at HOUSEKEEPING, due now. The slice runs daily, so every member rolls within 24 h of
//      their local Monday, and 12 weekly rows build up for P10's trends;
//   2. heal sweep (replaces a GET-side heal, AP-09): entitled members with no snapshot at ALGO_VERSION, or whose last
//      recompute the kill switch skipped (FIX-2: "paused" ends the day the switch is back on), and no active
//      RECOMPUTE_WEAKNESS row, whose window holds at least 5 analysed games (a LIMIT 5 probe) → `heal` (no snapshot
//      yet, or paused) or `algo` (an older algorithm's snapshot);
//   3. prune: snapshots past the newest 12 per member (batched, 1,000 rows a day).
//
// The enqueues are the shared §7.4.1 upsert (@repo/db/weakness-jobs: coalesced, never a second row). A zone Postgres
// does not know (users."timeZone" is validated by Intl on write; the two lists can differ) counts as UTC instead of
// failing the whole HOUSEKEEPING batch. `after()` logs the counts and wakes the I/O lane when anything was armed.
// With WEAKNESS_JOBS_ENABLED off only the prune runs.
import { ALGO_VERSION, KEEP_WEEKS, PRELIMINARY_FROM, SCOPE_DEFAULT, SCOPE_MONTHS } from "@repo/chess-training/weakness/constants";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { enqueueWeaknessManySql } from "@repo/db/weakness-jobs";
import { fromPrisma, num, stmt, type Statement } from "../../db/client";
import { NOW } from "../../queue/claim";
import type { WeaknessSettings } from "../../weakness/settings";
import type { RecurringSlice } from "./types";

/** Members rolled / healed per day (the rest go the next day; 100 members × 2 s / 2 lanes ≈ 100 s of I/O lane). */
export const WEAKNESS_ROLL_MAX = 1_000;
export const WEAKNESS_HEAL_MAX = 500;
/** Snapshot rows pruned per day. */
export const WEAKNESS_PRUNE_MAX = 1_000;
/** "Recently active" for the weekly roll: a review or a game in this many days. */
export const WEAKNESS_ACTIVE_DAYS = 30;

const int = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("weakness slice: a non-negative integer is required");
  return String(n);
};

/** The member's zone as Postgres knows it, else UTC (one hashed scan of pg_timezone_names per statement). */
const TZ = `(CASE WHEN u."timeZone" IN (SELECT name FROM pg_timezone_names) THEN u."timeZone" ELSE 'UTC' END)`;

/** The web's `isEntitled` + admin (worker import/context.ts isMember with the paywall on), in SQL. */
const ENTITLED = `(u.role = 'ADMIN' OR u."subscriptionStatus" = 'active'
          OR (u."subscriptionStatus" = 'cancelled' AND u."cancelAtPeriodEnd" AND u."currentPeriodEnd" > ${NOW})
          OR (u."subscriptionStatus" IN ('on_hold', 'past_due') AND u."currentPeriodEnd" > ${NOW}))`;

/** The scope window start (TRN scopeSince: local midnight of the 1st, `months` back) as a UTC timestamp. */
const SINCE = `((date_trunc('month', now() AT TIME ZONE ${TZ})
            - make_interval(months => CASE WHEN tp."weaknessMonths" IN (${SCOPE_MONTHS.join(", ")}) THEN tp."weaknessMonths"::int
                                           ELSE ${int(SCOPE_DEFAULT.months)} END)) AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC'`;

/** Wraps an upsert whose rows come from the CTE `cand` (parameter-free text) into one statement. */
function armStatement(cte: string, label: string, s: WeaknessSettings): Statement {
  const up = fromPrisma(
    enqueueWeaknessManySql({
      rows: `SELECT c."userId", c.trigger FROM cand c`,
      priority: JOB_PRIORITY.HOUSEKEEPING,
      runAt: null,
      debounceSec: 0,
      freezeSeeded: s.seedFreeze,
    }),
  );
  return stmt(
    `WITH ${cte}, up AS (
  ${up.text}
)
SELECT count(*)::int AS ${label}, count(*) FILTER (WHERE NOT up.created)::int AS coalesced FROM up`,
    up.values,
  );
}

/** Statement 1: the weekly roll. */
export function weeklyRollStatement(s: WeaknessSettings, max = WEAKNESS_ROLL_MAX): Statement {
  return armStatement(
    `latest AS (
  SELECT DISTINCT ON (ws."userId") ws."userId", ws."weekStart"
    FROM weakness_snapshots ws ORDER BY ws."userId", ws."weekStart" DESC
), cand AS (
  SELECT l."userId", 'weekly'::text AS trigger
    FROM latest l JOIN users u ON u.id = l."userId"
   WHERE ${ENTITLED}
     AND l."weekStart" < date_trunc('week', now() AT TIME ZONE ${TZ})::date
     AND (EXISTS (SELECT 1 FROM training_attempts ta
                   WHERE ta."userId" = l."userId" AND ta."reviewedAt" >= ${NOW} - interval '${int(WEAKNESS_ACTIVE_DAYS)} days')
          OR EXISTS (SELECT 1 FROM game_players gp
                      WHERE gp."userId" = l."userId" AND gp."endedAt" >= ${NOW} - interval '${int(WEAKNESS_ACTIVE_DAYS)} days'))
   ORDER BY l."userId"
   LIMIT ${int(max)}
)`,
    "rolled",
    s,
  );
}

/** Statement 2: the heal sweep (`heal` without a snapshot, `algo` with an older algorithm's). */
export function healSweepStatement(s: WeaknessSettings, max = WEAKNESS_HEAL_MAX): Statement {
  return armStatement(
    `cand AS (
  SELECT u.id AS "userId",
         (CASE WHEN latest."algoVersion" < ${int(ALGO_VERSION)} THEN 'algo' ELSE 'heal' END)::text AS trigger
    FROM users u
    LEFT JOIN training_profiles tp ON tp."userId" = u.id
    LEFT JOIN LATERAL (SELECT ws."algoVersion" FROM weakness_snapshots ws
                        WHERE ws."userId" = u.id ORDER BY ws."weekStart" DESC LIMIT 1) latest ON true
   WHERE ${ENTITLED}
     AND (latest."algoVersion" IS NULL OR latest."algoVersion" < ${int(ALGO_VERSION)}
          -- FIX-2 (D-P6-FIX2-14): a member the kill switch paused (their last recompute ended DONE skipped "disabled"),
          -- whatever their snapshot: the page shows "Profile updates are paused" until a run succeeds.
          OR EXISTS (SELECT 1 FROM jobs pj WHERE pj."dedupeKey" = 'weakness:' || u.id::text AND pj.status = 'DONE'
                       AND pj.result->>'skipped' = 'disabled'))
     AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j."dedupeKey" = 'weakness:' || u.id::text AND j.status IN ('QUEUED', 'RUNNING'))
     AND (SELECT count(*) FROM (SELECT 1 FROM game_players gp
                                 WHERE gp."userId" = u.id AND gp."endedAt" >= ${SINCE} AND gp.accuracy IS NOT NULL
                                 LIMIT ${int(PRELIMINARY_FROM)}) x) = ${int(PRELIMINARY_FROM)}
   ORDER BY u.id
   LIMIT ${int(max)}
)`,
    "healed",
    s,
  );
}

/** Statement 3: keep the newest KEEP_WEEKS (12) snapshots per member. */
export function pruneSnapshotsStatement(max = WEAKNESS_PRUNE_MAX): Statement {
  return stmt(
    `WITH x AS (
  SELECT "userId", "weekStart", row_number() OVER (PARTITION BY "userId" ORDER BY "weekStart" DESC) AS rn
    FROM weakness_snapshots
), d AS (
  DELETE FROM weakness_snapshots ws
   USING (SELECT "userId", "weekStart" FROM x WHERE rn > $1 LIMIT $2) o
   WHERE ws."userId" = o."userId" AND ws."weekStart" = o."weekStart"
  RETURNING 1
)
SELECT count(*)::int AS pruned FROM d`,
    [KEEP_WEEKS, max],
  );
}

export const weaknessSlice: RecurringSlice = {
  id: "weakness",
  statements: (ctx) => {
    const s = ctx.weakness;
    const arm = s?.enabled ? [weeklyRollStatement(s), healSweepStatement(s)] : [];
    return [...arm, pruneSnapshotsStatement()];
  },
  async after(ctx, rows) {
    const armed = ctx.weakness?.enabled === true;
    const rolled = armed ? num(rows[0]?.[0]?.rolled ?? 0) : 0;
    const healed = armed ? num(rows[1]?.[0]?.healed ?? 0) : 0;
    const pruned = num(rows[armed ? 2 : 0]?.[0]?.pruned ?? 0);
    ctx.log.info("weakness slice", { rolled, healed, pruned });
    if (armed) {
      // §10.2 `worker.weakness.coalesced`: enqueues that met the member's existing row.
      const weekly = num(rows[0]?.[0]?.coalesced ?? 0);
      const heal = num(rows[1]?.[0]?.coalesced ?? 0);
      if (weekly > 0) ctx.telemetry?.metric("count", "worker.weakness.coalesced", weekly, { trigger: "weekly" });
      if (heal > 0) ctx.telemetry?.metric("count", "worker.weakness.coalesced", heal, { trigger: "heal" });
    }
    if (rolled + healed > 0) ctx.wakeIo?.();
  },
};
