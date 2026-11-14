-- replay_app (web) grants for M5 (phase-05 plan 6.2, 7.2-7.3). P1's scripts/db/replay-app-role.sql gives replay_app
-- DML on every table through ALTER DEFAULT PRIVILEGES FOR ROLE <owner>, so on a branch where the same owner ran both
-- that script and `prisma migrate deploy` this file only re-states and verifies what the web needs; the explicit grants
-- make the web work when the M5 tables were created by another role. Run it as the branch owner after
-- `prisma migrate deploy` has applied m5a and M5, on the Neon `dev` branch (ep-fancy-dust-b8b3dp81) or a local/CI
-- Postgres; never on the old project shy-morning-50748774:
--
--   psql "$OWNER_DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/db/scripts/roles/replay_app.p5.sql
--
-- Guarded: without a replay_app role it changes nothing and says so. Idempotent. What the web does with each table:
--   mistakes             R2/R3/HOME-1 reads; W6 and A6 set or clear "hiddenAt"; W7 checks a report target
--   mistake_occurrences  A1/A2 bank fields and A6 (the moment ↔ mistake link); read only (the worker writes it)
--   training_cards       W1 reschedules, W5 suspends, W6 and A6 delete, A6 creates a NEW card
--   training_attempts    W1 appends (the FSRS log is append-only; this file grants SELECT, INSERT only, though P1's
--                        default privileges may already give the web role more on a branch they cover)
--   training_sessions    W2 creates (and abandons the previous puzzle session), W3/W4 update
--   training_days        R1's lazy plan (the registered `daily_plan` GET side effect), W1's cap counters
--   theme_mastery        W1's EWMA, W6/A6 bankCount
--   training_profiles    R1's lazy row, W1's rating and streaks, W8's prefs
--   reports              W7 inserts and dedupes; P12's queue reads
-- The housekeeping prunes (stale ACTIVE sessions, old plans, 90-day sessions) are the worker's.

\set ON_ERROR_STOP on
\set QUIET on

SELECT current_database() AS target_db, current_user AS owner_role \gset
\echo 'target database:' :target_db ' owner role:' :owner_role

SELECT to_regclass('public.training_cards') IS NOT NULL AND to_regclass('public.reports') IS NOT NULL AS m5_applied \gset
\if :m5_applied
\else
  DO $$ BEGIN RAISE EXCEPTION 'M5 is not applied on this database: run prisma migrate deploy first'; END $$;
\endif

SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replay_app') AS role_ready \gset
\if :role_ready

GRANT SELECT, UPDATE ON mistakes TO replay_app;
GRANT SELECT ON mistake_occurrences TO replay_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON training_cards TO replay_app;
GRANT SELECT, INSERT ON training_attempts TO replay_app;
GRANT SELECT, INSERT, UPDATE ON training_sessions, training_days, theme_mastery, training_profiles TO replay_app;
GRANT SELECT, INSERT, UPDATE ON reports TO replay_app;
GRANT USAGE, SELECT ON SEQUENCE training_cards_id_seq, training_attempts_id_seq, training_sessions_id_seq, reports_id_seq TO replay_app;
-- W6 removal bumps the review's "updatedAt" (A1/A2 ETags change with the bank); P3 granted progress and updatedAt.
GRANT UPDATE ("updatedAt") ON player_reviews TO replay_app;

\set QUIET off
SELECT check_name, ok FROM (
  SELECT 'reads and hides mistakes' AS check_name,
         has_table_privilege('replay_app', 'public.mistakes', 'SELECT, UPDATE')
         AND has_table_privilege('replay_app', 'public.mistake_occurrences', 'SELECT') AS ok
  UNION ALL
  SELECT 'schedules, creates and removes cards',
         has_table_privilege('replay_app', 'public.training_cards', 'SELECT, INSERT, UPDATE, DELETE')
         AND has_sequence_privilege('replay_app', 'public.training_cards_id_seq', 'USAGE')
  UNION ALL
  SELECT 'appends attempts',
         has_table_privilege('replay_app', 'public.training_attempts', 'SELECT, INSERT')
         AND has_sequence_privilege('replay_app', 'public.training_attempts_id_seq', 'USAGE')
  UNION ALL
  SELECT 'sessions, days, mastery and profiles',
         has_table_privilege('replay_app', 'public.training_sessions', 'SELECT, INSERT, UPDATE')
         AND has_table_privilege('replay_app', 'public.training_days', 'SELECT, INSERT, UPDATE')
         AND has_table_privilege('replay_app', 'public.theme_mastery', 'SELECT, INSERT, UPDATE')
         AND has_table_privilege('replay_app', 'public.training_profiles', 'SELECT, INSERT, UPDATE')
  UNION ALL
  SELECT 'files reports', has_table_privilege('replay_app', 'public.reports', 'SELECT, INSERT')
  UNION ALL
  SELECT 'bumps the review on a removal', has_column_privilege('replay_app', 'public.player_reviews', 'updatedAt', 'UPDATE')
) checks;

\else
  \echo 'replay_app does not exist on this database: nothing changed'
\endif
