# Runbook: the Weakness Profile in operation

The Weakness Profile (`/train/weakness`) is built by the analysis worker's `RECOMPUTE_WEAKNESS` job from the five P6
input columns every graded game carries (`game_players`), and served from one `weakness_snapshots` row per member and
week. Plan: `docs/plan/phase-06-weakness-profile.md` (§4 states, §7.4 jobs, §8.14 status, §14.4 rollback). The band
numbers are the baseline's: `docs/runbooks/weakness-baseline.md`.

Safety first (CLAUDE.md): never `prisma db push`, never `prisma migrate dev` against Neon; M6 is expand-only and has no
down migration. Anything below that would drop or delete more than the rows it names stops and asks the owner: "This
command may reset/drop your database. Are you sure?". Every SQL below names one member (`$USER_ID`); run it on the
branch you mean (dev: Neon branch `dev`, `br-misty-dew-b8wy3a8w`; production: only with the owner).

## 1. The states and where each comes from

| Page state | Decided by (TR-5, `deriveStatus`) | What the member sees | What to look at |
|---|---|---|---|
| `insufficient` | fewer than 20 in-scope games, no READY snapshot, nothing running | the meter, preliminary patterns (an INSUFFICIENT snapshot after 5, 10, 15 graded games), import / play CTAs; the bullet offer when the window's bullet games fill the gap | `game_players` of the member in scope; `weakness_snapshots.status = 'INSUFFICIENT'` |
| `computing` | 20+ in scope but no READY yet, or a recompute QUEUED/RUNNING, or an import running | the steps, the ETA from the worker's rate, the milestones; "Taking longer than usual" once nothing graded for 10 min while analyses wait (`stalled`) | `jobs` of the member (`ANALYZE_GAME` with `"userId"`, `RECOMPUTE_WEAKNESS` `dedupeKey = 'weakness:<id>'`), `game_analyses."completedAt"` |
| `computing` + orphaned | 5+ graded in scope, no snapshot and no recompute row (or INSUFFICIENT although 20 are graded) | the page sends one auto-build TR-12 (a second within 10 min is a quiet 429) | the backfills B-W1/B-W3 (`apps/web/scripts/backfill/p06-*`) |
| `ready` | the newest snapshot is READY | the rows, the tabs, drills; "Updating with N new games…" while a recompute is pending | `weakness_snapshots.metrics` (`WeaknessMetricsV1`) |
| `failed` | the snapshot is FAILED, or the last recompute exhausted its attempts, and nothing is pending | Retry (TR-12; one per 10 min per member, durable in the job row's `payload.userAt`) | `jobs."lastError"` (`worker_stalled`, `synthetic_baseline_refused`, …), Sentry `job.RECOMPUTE_WEAKNESS` |

## 2. A member stuck in computing

1. Read the member's jobs (dev branch, read only):

   ```sql
   SELECT id, kind, status, attempts, "runAt", "lockedBy", "heartbeatAt", "lastError"
     FROM jobs WHERE "userId" = $USER_ID AND status IN ('QUEUED', 'RUNNING') ORDER BY "runAt";
   SELECT status, attempts, "runAt", payload, "lastError" FROM jobs WHERE "dedupeKey" = 'weakness:' || $USER_ID;
   ```

2. QUEUED rows due in the past and nothing RUNNING: the worker was not woken. Opening the page sends the TR-5 kick CAS
   (at most one kick per 30 s); otherwise the worker's drain-end sweep and the daily HOUSEKEEPING wake catch up. Check the
   worker: `ssh -i ~/.ssh/oci_deploy deploy@80.225.200.210` (dev), `docker compose logs --since 30m analysis-worker`.
3. A RUNNING row whose `heartbeatAt` is more than 3 minutes old belongs to a dead worker: the next drain's reaper takes
   it (QUEUED again, or FAILED on its last attempt, which writes the FAILED snapshot and pushes `weakness:ready`).
4. ANALYZE_GAME rows due far ahead (`runAt` years away) are a persona's frozen picture (`weak-computing` /
   `dev-weak-compute`), never product data: `npx tsx e2e/scripts/seed-weakness.ts --reset <pool> --step weak-computing:ready`.
5. The 10-minute "stalled" copy is expected while the dev worker grades a long import with Stockfish (≈ 10–20 s a game).

## 3. Re-enqueue a recompute

- One member, as the member would: Retry on the page (TR-12). As an operator: the coalescing upsert the triggers use
  (one row per member, never a second one), then a kick:

  ```sh
  cd apps/web && npx tsx -e '
    import { PrismaClient } from "@repo/db"; import { enqueueWeaknessSql } from "@repo/db/weakness-jobs";
    const db = new PrismaClient();
    await db.$queryRaw(enqueueWeaknessSql({ userId: BigInt(process.env.USER_ID!), trigger: "heal", priority: 100, runAt: new Date(), debounceSec: 0 }));
    await db.$disconnect();'
  ```

- Many members (an `ALGO_VERSION` bump, a baseline change): B-W3 `apps/web/scripts/backfill/enqueue-weakness-recompute.ts`
  (dry run by default, `--apply`, batched, writes an `audit_logs` row). Inputs that a codec bug spoiled: bump the input
  version, then B-W1 `backfill-weakness-inputs.ts` (no engine work).

## 4. The kill switch

`WEAKNESS_JOBS_ENABLED=off` in the worker's env (OCI compose file, then `docker compose up -d analysis-worker`): recomputes
end DONE `skipped: "disabled"`, the worker's own triggers do nothing, pages keep serving the last snapshot. It is a
production control (listed in `apps/web/lib/test-hooks/registry.ts` `KILL_SWITCHES`), allowed everywhere. Default: on
in dev/test/local, off in production until P13. A member without a READY profile (and with ≥ 5 analysed games) whose
last recompute the switch skipped sees "Profile updates are paused" with no Retry and no auto-build (FIX-1, the web
reads the job row's `skipped: "disabled"`); once the switch is on again the daily heal sweep (21:00 UTC) re-arms every
member whose last run the switch skipped, whatever their snapshot (FIX-2, D-P6-FIX2-14), and rebuilds them.

### The heal (rows analysed before P6)

A recompute heals at most `WEAKNESS_HEAL_MAX_ROWS` (40) rows a run and stops computing after 1.5 s of the machine's own
time, commits them, writes no snapshot and re-queues itself 2 s later (job `result` `{healed, healRemaining}`); the last
run writes the snapshot. A member with 300 pre-P6 rows on the 1-OCPU worker takes about 15 short runs. B-W1 fills the
same columns in bulk first, so on dev and production the heal is the fallback.

FIX-2 (D-P6-FIX2-8):
- A row whose stored analysis cannot be read is marked `weaknessInputsV = −1` and never picked again (a later analysis
  or regrade overwrites it); rows whose analysis is being redone (`completedAt` cleared) are left to their analysis.
  Find them: `SELECT "gameId" FROM game_players WHERE "userId" = $1 AND "weaknessInputsV" = -1` (metric
  `worker.weakness.heal_failed`).
- Heal and B-W1 read stored rows only, so an error without a stored pass-2 line is tagged from its best move there;
  each such game gets one ANALYZE_GAME `regrade` at HOUSEKEEPING priority (metric `worker.weakness.lines_regrades`,
  B-W1's "engine regrade(s) armed" line), and the worker's regrade path searches every member error's line and
  refutation and rewrites the inputs as a fresh analysis would. Expect the engine lane to work through them after B-W1
  on dev (hundreds of games) and at P13 on production (every pre-P6 game: ≈ 1–2 s of engine time each on the A1).

FIX-3 (D-P6-FIX3-1 … 10):
- Failed rows carry the inputs version they failed under (`weaknessInputsV = −version`, −1 today). A build with a
  higher `WEAKNESS_INPUTS_VERSION` (a fixed tagger) retries them once: the daily heal sweep arms their members; a
  second failure is marked with the new −version and never retried by that build. Find them:
  `SELECT "gameId", "weaknessInputsV" FROM game_players WHERE "userId" = $1 AND "weaknessInputsV" < 0`.
- The lines refresh rows (`weaklines:<gameId>`) are payload `v: 2`: a worker image older than FIX-3 never claims them
  (they wait, QUEUED). Their failure, release or reap never touches the game (no FAILED, no `analysis:failed`). Only
  games with at least one entitled member side are armed. With `WEAKNESS_JOBS_ENABLED` off a refresh is not lost: it
  waits QUEUED a day later (attempts not counted) and runs once the switch is back on.
- The weakness-only engine searches of one analysis, regrade or refresh stop after `WEAKNESS_LINES_BUDGET_MS`
  (default 20 s; metric `worker.weakness.lines_cut {why: budget|engine}`); a failed search never fails the analysis or
  the regrade: its error keeps "no line" and a `weakness_lines` refresh of the game is armed.
- A recompute whose inputs or example mistakes an IMPORT_PURGE removed after it read them discards its result and runs
  again at once (`result.discarded = "inputs_changed"`, metric `worker.weakness.discarded`); a purge also re-arms a
  member whose recompute is QUEUED or RUNNING, so no profile of purged games survives.
- B-W1 `--verify` compares `stats` and `errorLog` on every sampled row and the themes only where the stored analysis
  holds every member error's line and refutation (rows tagged from the analysis's own pass-1 lines or a lines refresh
  cannot be recomputed from stored data). It prints "themes compared on N, not comparable on M"; only a DIFFERS row or
  a side still at 0 fails it (exit 1).

### Migrations

Any further schema change for P6 on the dev branch is rehearsed first on a throwaway Neon child branch of `dev` (a
`prisma migrate deploy` there, the checks of INTEGRATE-1 §3, then delete the child), and only then applied to `dev`
(plan WP3 acceptance; M6 itself reached `dev` after a Docker rehearsal only, FIX-1 finding).

## 5. Rollback (plan §14.4)

| Lever | How | Effect | Data |
|---|---|---|---|
| Flag `weakness` off | PostHog flag (or `FLAGS_OVERRIDE` on non-production) | `/train/weakness` → `/train`; TR-5/12/13 and TR-7 `weakness` → 404; the hub row, Home line, nav, ⌘K, `g w` and the dot disappear | kept |
| Kill switch | §4 | no recomputes | kept |
| Worker image | redeploy the previous tag (`deploy-oci.yml`) | an older worker never claims `RECOMPUTE_WEAKNESS`: rows wait QUEUED; older `analyzeGame` leaves the input columns at their defaults (the heal fills them later) | kept |
| Web | redeploy the previous Vercel deployment | M6 is expand-only: older code ignores the columns and the table | kept |
| Bad numbers | fix, bump `ALGO_VERSION`, run B-W3 | snapshots are always rebuilt from the inputs; none is deleted to recover | rebuilt |

### The volume gate (plan §9.1)

`cd apps/web && DATABASE_URL=<a throwaway local Postgres after migrate deploy> npx tsx scripts/explain-weakness-volume.ts
--seed` builds a template member through the product's pipelines, clones it to 20 members × 2,000 games, 500 mistakes and
3,000 attempts, and times the hot statements (`EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)`, the median of 5) against the
plan's limits; it refuses non-local hosts. CI runs it in the integration job (artifact `p06-volume`).

## 6. Drift (the nightly `weakness-recompute-check`)

The nightly job resets pool user 24 to `weak-member` on the dev branch, asks the dev site for a recompute and compares
the dev worker's snapshot with the repository's computation on the same rows
(`apps/analysis-worker/scripts/nightly-weakness-check.ts`). A `weakness-drift` issue lists the differing paths:

- `$.metrics.inputs.baseline` differs: the dev worker runs another baseline (an old image, or a baseline file not bundled).
- `$.metrics.rows…` or `$.headline` differ with the same baseline: the deployed worker's compute differs from the
  repository's (a deploy behind `dev`, or an algorithm change without an `ALGO_VERSION` bump).
- "no snapshot within 120 s": the dev worker was not woken or is down (§2).
The job's `DEV_WEB_INTERNAL_API_SECRET` is a ring holding ONLY the worker-only kid `webwk` (`webwk:<base64>`, the same
key as the dev web's `webwk` entry): the persona tool's worker kick signs with it, and the job refuses a ring with any
other kid (FIX-2: the web's `web` kid may emit every socket event to any room). Re-run by hand: `workflow_dispatch` of nightly.yml, or locally against a Docker stack (the script refuses any database but
the dev endpoint and a local Postgres).

## 7. Personas for testing

`apps/web/e2e/scripts/seed-weakness.ts --list` (dev seed names: new, trial, member, weakcompute, weakfail, bullet,
noclock). Each is real data graded by the running worker; on the dev branch the first lease of a 54-game persona takes
the dev worker 10–20 minutes. Shared e2e letters A–R are never touched.
