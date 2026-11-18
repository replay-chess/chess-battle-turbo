-- replay_app (web) grants for M6 (phase-06 plan 6.2.3, 7.1). P1's scripts/db/replay-app-role.sql gives replay_app DML
-- on every table through ALTER DEFAULT PRIVILEGES FOR ROLE <owner>, so on a branch where the same owner ran both that
-- script and `prisma migrate deploy` this file only re-states and verifies what the web needs; the explicit grants make
-- the web work when the M6 table was created by another role. Run it as the branch owner after
-- `prisma migrate deploy` has applied M6 (20261117000000_m6_weakness), on the Neon `dev` branch
-- (ep-fancy-dust-b8b3dp81) or a local/CI Postgres; never on the old project shy-morning-50748774:
--
--   psql "$OWNER_DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/db/scripts/roles/replay_app.p6.sql
--
-- Guarded: without a replay_app role it changes nothing and says so. Idempotent. What the web does:
--   weakness_snapshots  TR-5, the hub and Home read the latest snapshot (Q-W1); the worker is the only writer
--   training_profiles   TR-13 raises "lastWeaknessSeenVersion" (Q-W9); TR-12 stores the scope ("weaknessTimeClasses",
--                       "weaknessMonths"); R1's lazy row insert (P5) already writes "updatedAt"
--   jobs                TR-12 upserts RECOMPUTE_WEAKNESS (the §7.4.1 statement: insert, or move runAt / priority /
--                       payload of the pending row); TR-5's after() kick CAS sets "lastKickAt" (Q-W12). P3's file
--                       granted these columns; verified below
--   game_players        TR-5's progress probe reads it (P1's default privileges / P2)

\set ON_ERROR_STOP on
\set QUIET on

SELECT current_database() AS target_db, current_user AS owner_role \gset
\echo 'target database:' :target_db ' owner role:' :owner_role

SELECT to_regclass('public.weakness_snapshots') IS NOT NULL AND EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'training_profiles' AND column_name = 'weaknessMonths') AS m6_applied \gset
\if :m6_applied
\else
  DO $$ BEGIN RAISE EXCEPTION 'M6 is not applied on this database: run prisma migrate deploy first'; END $$;
\endif

SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replay_app') AS role_ready \gset
\if :role_ready

GRANT SELECT ON weakness_snapshots TO replay_app;
GRANT SELECT, INSERT ON training_profiles TO replay_app;
GRANT UPDATE ("lastWeaknessSeenVersion", "weaknessTimeClasses", "weaknessMonths", "updatedAt") ON training_profiles TO replay_app;
GRANT SELECT, INSERT ON jobs TO replay_app;
-- An `INSERT … ON CONFLICT DO UPDATE` needs UPDATE on every column its SET list names, even when the CASE keeps the old
-- value: requestRecomputeSql's conflict clause also names "lockedBy", "lockedAt", "heartbeatAt" and "startedAt" (P3's
-- file grants them too; re-stated so this file alone is enough for TR-12).
GRANT UPDATE ("lastKickAt", "runAt", priority, payload, status, attempts, "maxAttempts", "lastError", result,
              "finishedAt", "lockedBy", "lockedAt", "heartbeatAt", "startedAt") ON jobs TO replay_app;
GRANT USAGE, SELECT ON SEQUENCE jobs_id_seq TO replay_app;

\set QUIET off
SELECT check_name, ok FROM (
  SELECT 'reads weakness snapshots' AS check_name, has_table_privilege('replay_app', 'public.weakness_snapshots', 'SELECT') AS ok
  UNION ALL
  SELECT 'marks the profile seen and stores the scope',
         has_column_privilege('replay_app', 'public.training_profiles', 'lastWeaknessSeenVersion', 'UPDATE')
         AND has_column_privilege('replay_app', 'public.training_profiles', 'weaknessTimeClasses', 'UPDATE')
         AND has_column_privilege('replay_app', 'public.training_profiles', 'weaknessMonths', 'UPDATE')
         AND has_column_privilege('replay_app', 'public.training_profiles', 'updatedAt', 'UPDATE')
         AND has_table_privilege('replay_app', 'public.training_profiles', 'SELECT, INSERT')
  UNION ALL
  SELECT 'requests a recompute and kicks a stale one',
         has_table_privilege('replay_app', 'public.jobs', 'SELECT, INSERT')
         AND has_column_privilege('replay_app', 'public.jobs', 'lastKickAt', 'UPDATE')
         AND has_column_privilege('replay_app', 'public.jobs', 'runAt', 'UPDATE')
         AND has_column_privilege('replay_app', 'public.jobs', 'payload', 'UPDATE')
         AND has_column_privilege('replay_app', 'public.jobs', 'priority', 'UPDATE')
         AND has_column_privilege('replay_app', 'public.jobs', 'lockedBy', 'UPDATE')
         AND has_column_privilege('replay_app', 'public.jobs', 'lockedAt', 'UPDATE')
         AND has_column_privilege('replay_app', 'public.jobs', 'heartbeatAt', 'UPDATE')
         AND has_column_privilege('replay_app', 'public.jobs', 'startedAt', 'UPDATE')
         AND has_sequence_privilege('replay_app', 'public.jobs_id_seq', 'USAGE')
  UNION ALL
  SELECT 'reads the progress probe inputs',
         has_table_privilege('replay_app', 'public.game_players', 'SELECT')
         AND has_table_privilege('replay_app', 'public.linked_accounts', 'SELECT')
) checks;

\else
  \echo 'replay_app does not exist on this database: nothing changed'
\endif
