-- replay_realtime (the socket server) grants for M3 (phase-03 plan 6.3; P2's role from packages/db/sql/roles.sql).
-- P3's finishGame fragment (packages/db/src/live/finish.fragments.p3.ts) inserts the ANALYZE_GAME job in the finish
-- CTE and sets games."analysisStatus"; the abort statement sets it to SKIPPED. The role already has table-level
-- INSERT/UPDATE on games and UPDATE ("gamesVersion") on users (roles.sql). This file adds exactly:
--   * INSERT, SELECT on jobs and USAGE on jobs_id_seq. No UPDATE and no DELETE: the fragment's insert is
--     `ON CONFLICT ("dedupeKey") DO NOTHING` (a live game cannot have an analysis job before it finishes, because
--     packages/db/src/jobs.ts only enqueues COMPLETED games), and SELECT covers its RETURNING / count;
--   * SELECT on the new games columns (roles.sql grants games SELECT column by column, computed when it runs, so
--     columns added by M3 are not readable until roles.sql is re-run; granting them here keeps the two in step).
--
-- Run it as the branch owner, after `prisma migrate deploy` (M3) and after packages/db/sql/roles.sql, on the Neon
-- `dev` branch (ep-fancy-dust-b8b3dp81) or a local/CI Postgres; never on the old project shy-morning-50748774:
--
--   psql "$OWNER_DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/db/scripts/roles/socket.p3.sql
--
-- Guarded (plan 6.3): without a replay_realtime role it changes nothing and says so. Idempotent.

\set ON_ERROR_STOP on
\set QUIET on

SELECT current_database() AS target_db, current_user AS owner_role \gset
\echo 'target database:' :target_db ' owner role:' :owner_role

SELECT to_regclass('public.jobs') IS NOT NULL AS m3_applied \gset
\if :m3_applied
\else
  DO $$ BEGIN RAISE EXCEPTION 'M3 is not applied on this database: run prisma migrate deploy first'; END $$;
\endif

SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replay_realtime') AS role_ready \gset
\if :role_ready

GRANT INSERT, SELECT ON jobs TO replay_realtime;
GRANT USAGE, SELECT ON SEQUENCE jobs_id_seq TO replay_realtime;
GRANT SELECT ("analysisStatus", "ecoCode", "openingName") ON games TO replay_realtime;
GRANT UPDATE ("analysisStatus") ON games TO replay_realtime;            -- already covered by table-level UPDATE
GRANT UPDATE ("gamesVersion") ON users TO replay_realtime;               -- already granted by roles.sql

\set QUIET off
SELECT check_name, ok FROM (
  SELECT 'can insert the analysis job in the finish CTE' AS check_name,
         has_table_privilege('replay_realtime', 'public.jobs', 'INSERT, SELECT')
         AND has_sequence_privilege('replay_realtime', 'public.jobs_id_seq', 'USAGE') AS ok
  UNION ALL
  SELECT 'cannot update or delete jobs',
         NOT has_table_privilege('replay_realtime', 'public.jobs', 'UPDATE')
         AND NOT has_table_privilege('replay_realtime', 'public.jobs', 'DELETE')
  UNION ALL
  SELECT 'can read and set games.analysisStatus',
         has_column_privilege('replay_realtime', 'public.games', 'analysisStatus', 'SELECT, UPDATE')
  UNION ALL
  SELECT 'cannot touch the analysis tables',
         NOT has_table_privilege('replay_realtime', 'public.game_analyses', 'SELECT')
         AND NOT has_table_privilege('replay_realtime', 'public.player_reviews', 'SELECT')
         AND NOT has_table_privilege('replay_realtime', 'public.shares', 'SELECT')
  UNION ALL
  SELECT 'still no DELETE or TRUNCATE anywhere',
         NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                        AND (has_table_privilege('replay_realtime', c.oid, 'DELETE')
                             OR has_table_privilege('replay_realtime', c.oid, 'TRUNCATE')))
) checks;

\else
  \echo 'replay_realtime does not exist on this database: nothing changed'
\endif
