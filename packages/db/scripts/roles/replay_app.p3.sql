-- replay_app (web) grants for M3 (phase-03 plan 6.3). P1's scripts/db/replay-app-role.sql gives replay_app DML on
-- every table through ALTER DEFAULT PRIVILEGES FOR ROLE <owner>, so on a branch where the same owner ran both that
-- script and `prisma migrate deploy` this file only re-states and verifies what the web needs. It matters when the
-- M3 tables were created by a different role than the one whose defaults were set (the defaults then do not
-- apply): the explicit grants below make the web work either way.
--
-- Run it as the branch owner after `prisma migrate deploy` has applied M3, on the Neon `dev` branch
-- (ep-fancy-dust-b8b3dp81) or a local/CI Postgres; never on the old project shy-morning-50748774:
--
--   psql "$OWNER_DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/db/scripts/roles/replay_app.p3.sql
--
-- Guarded (plan 6.3): without a replay_app role it changes nothing and says so. Idempotent.

\set ON_ERROR_STOP on
\set QUIET on

SELECT current_database() AS target_db, current_user AS owner_role \gset
\echo 'target database:' :target_db ' owner role:' :owner_role

SELECT to_regclass('public.jobs') IS NOT NULL AND to_regclass('public.shares') IS NOT NULL AS m3_applied \gset
\if :m3_applied
\else
  DO $$ BEGIN RAISE EXCEPTION 'M3 is not applied on this database: run prisma migrate deploy first'; END $$;
\endif

SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replay_app') AS role_ready \gset
\if :role_ready

-- jobs: A3/A4/A9b enqueue (packages/db/src/jobs.ts: insert, priority raise, regrade reset) and the healKick CAS.
-- An `INSERT … ON CONFLICT DO UPDATE` needs UPDATE on every column its SET list names, even when the CASE keeps the
-- old value, so the list is every column the conflict policies write. Never id, kind, "dedupeKey", "userId",
-- "gameId" or "createdAt".
GRANT SELECT, INSERT ON jobs TO replay_app;
GRANT UPDATE (priority, "fairSeq", "runAt", status, payload, attempts, "maxAttempts", "lockedBy", "lockedAt",
              "heartbeatAt", "lastError", result, "startedAt", "finishedAt", "lastKickAt") ON jobs TO replay_app;
GRANT USAGE, SELECT ON SEQUENCE jobs_id_seq TO replay_app;
-- Review reads (A1/A2 probe and payload) and the walkthrough writes (A5 through review_progress_merge, A6, A7).
GRANT SELECT ON game_analyses TO replay_app;
GRANT SELECT ON player_reviews TO replay_app;
GRANT UPDATE (progress, "startedAt", "completedAt", "updatedAt") ON player_reviews TO replay_app;
-- Legend facts (bot complete, A2/A9 lazy insert, A9b attempts) and shares (A10/A11).
GRANT SELECT, INSERT, UPDATE ON legend_comparisons, shares TO replay_app;
GRANT USAGE, SELECT ON SEQUENCE shares_id_seq TO replay_app;
-- Status flips that ride with an enqueue or a retry, and the archive ETag bump (P3-D27).
GRANT UPDATE ("analysisStatus") ON games TO replay_app;
GRANT UPDATE ("gamesVersion") ON users TO replay_app;
GRANT EXECUTE ON FUNCTION review_progress_merge(jsonb, jsonb, int) TO replay_app;

\set QUIET off
SELECT check_name, ok FROM (
  SELECT 'can enqueue and heal-kick jobs' AS check_name,
         has_table_privilege('replay_app', 'public.jobs', 'SELECT, INSERT')
         AND has_column_privilege('replay_app', 'public.jobs', 'priority', 'UPDATE')
         AND has_column_privilege('replay_app', 'public.jobs', 'lastKickAt', 'UPDATE')
         AND has_column_privilege('replay_app', 'public.jobs', 'heartbeatAt', 'UPDATE')
         AND has_column_privilege('replay_app', 'public.jobs', 'maxAttempts', 'UPDATE')
         -- No "cannot UPDATE dedupeKey" row: P1's replay-app-role.sql grants replay_app table-level DML on every
         -- table (GRANT … ON ALL TABLES + ALTER DEFAULT PRIVILEGES), so on a branch where both scripts ran that
         -- negative is false by design. The column list above is the floor the web needs, not a ceiling.
         AND has_sequence_privilege('replay_app', 'public.jobs_id_seq', 'USAGE') AS ok
  UNION ALL
  SELECT 'can read the review and write progress',
         has_table_privilege('replay_app', 'public.game_analyses', 'SELECT')
         AND has_table_privilege('replay_app', 'public.player_reviews', 'SELECT')
         AND has_column_privilege('replay_app', 'public.player_reviews', 'progress', 'UPDATE')
         AND has_function_privilege('replay_app', 'review_progress_merge(jsonb, jsonb, integer)', 'EXECUTE')
  UNION ALL
  SELECT 'can write legend facts and shares',
         has_table_privilege('replay_app', 'public.legend_comparisons', 'SELECT, INSERT, UPDATE')
         AND has_table_privilege('replay_app', 'public.shares', 'SELECT, INSERT, UPDATE')
         AND has_sequence_privilege('replay_app', 'public.shares_id_seq', 'USAGE')
  UNION ALL
  SELECT 'can flip analysisStatus and bump gamesVersion',
         has_column_privilege('replay_app', 'public.games', 'analysisStatus', 'UPDATE')
         AND has_column_privilege('replay_app', 'public.users', 'gamesVersion', 'UPDATE')
) checks;

\else
  \echo 'replay_app does not exist on this database: nothing changed'
\endif
