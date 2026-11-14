-- replay_worker grants for M5 (phase-05 plan 3.2, 6.2, 7.6, 11): the Mistake Bank extraction (J1 inside the final
-- analysis batch, and the EXTRACT_MISTAKES backfill job) and the training hygiene of the daily HOUSEKEEPING. Run it after
-- replay_worker.sql (which creates the role and the P3 grants), replay_worker.p4.sql, and after `prisma migrate deploy`
-- has applied m5a and M5 (20261114000100_m5_training), on the Neon `dev` branch (ep-fancy-dust-b8b3dp81) or a local/CI
-- Postgres; P13 repeats it on production. Never on shy-morning-50748774.
--
--   psql "$OWNER_DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/db/scripts/roles/replay_worker.p5.sql
--
-- Guarded: without a replay_worker role it changes nothing and says so. Idempotent. Least privilege, as P3/P4's files:
--   * mistakes, mistake_occurrences, training_cards, theme_mastery: SELECT, INSERT, UPDATE (the set-based J1 statements:
--     upsert, occurrence insert + recount, card insert + recurrence / changed-best reset, bankCount); NO DELETE: only
--     the member removes a card or hides a mistake (the web's W6 / A6);
--   * training_profiles, training_days: SELECT (the member's prefs in the job-load statement; today's cap counters for
--     `bankDue`), plus UPDATE (plan, "updatedAt") on training_days for the 7-day plan drop;
--   * training_sessions: SELECT, DELETE and UPDATE (status, "endedAt") for the housekeeping (stale ACTIVE → ABANDONED,
--     the 90-day prune); never a session's items, owner or counters;
--   * game_players: UPDATE ("bankVersion"), the extraction marker;
--   * no access to training_attempts (the member's FSRS log) or reports (moderation).
-- users."timeZone" (the job-load statement) is P4's grant; player_reviews (the opt-out read) is P3's.

\set ON_ERROR_STOP on
\set QUIET on

SELECT current_database() AS target_db, current_user AS owner_role \gset
\echo 'target database:' :target_db ' owner role:' :owner_role

SELECT to_regclass('public.mistakes') IS NOT NULL AND to_regclass('public.training_cards') IS NOT NULL
       AND to_regclass('public.training_sessions') IS NOT NULL AND EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'game_players' AND column_name = 'bankVersion') AS m5_applied \gset
\if :m5_applied
\else
  DO $$ BEGIN RAISE EXCEPTION 'M5 is not applied on this database: run prisma migrate deploy first'; END $$;
\endif

SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replay_worker') AS role_ready \gset
\if :role_ready

-- J1 / EXTRACT_MISTAKES (plan 7.6 statements 0-7).
GRANT SELECT, INSERT, UPDATE ON mistakes, mistake_occurrences, training_cards, theme_mastery TO replay_worker;
GRANT USAGE, SELECT ON SEQUENCE mistakes_id_seq, training_cards_id_seq TO replay_worker;
GRANT SELECT ON training_profiles, training_days TO replay_worker;
GRANT UPDATE ("bankVersion") ON game_players TO replay_worker;

-- HOUSEKEEPING training hygiene (scheduler/recurring/training-hygiene.ts).
GRANT SELECT, DELETE ON training_sessions TO replay_worker;
GRANT UPDATE (status, "endedAt") ON training_sessions TO replay_worker;
GRANT UPDATE (plan, "updatedAt") ON training_days TO replay_worker;

\set QUIET off
SELECT check_name, ok FROM (
  SELECT 'extracts: mistakes, occurrences, cards and theme counts (SELECT, INSERT, UPDATE, sequences)' AS check_name,
         has_table_privilege('replay_worker', 'public.mistakes', 'SELECT, INSERT, UPDATE')
         AND has_table_privilege('replay_worker', 'public.mistake_occurrences', 'SELECT, INSERT, UPDATE')
         AND has_table_privilege('replay_worker', 'public.training_cards', 'SELECT, INSERT, UPDATE')
         AND has_table_privilege('replay_worker', 'public.theme_mastery', 'SELECT, INSERT, UPDATE')
         AND has_sequence_privilege('replay_worker', 'public.mistakes_id_seq', 'USAGE')
         AND has_sequence_privilege('replay_worker', 'public.training_cards_id_seq', 'USAGE') AS ok
  UNION ALL
  SELECT 'never deletes a mistake, an occurrence, a card or a theme row',
         NOT has_table_privilege('replay_worker', 'public.mistakes', 'DELETE')
         AND NOT has_table_privilege('replay_worker', 'public.mistake_occurrences', 'DELETE')
         AND NOT has_table_privilege('replay_worker', 'public.training_cards', 'DELETE')
         AND NOT has_table_privilege('replay_worker', 'public.theme_mastery', 'DELETE')
  UNION ALL
  SELECT 'reads the prefs and today''s counters, writes only a day''s plan',
         has_table_privilege('replay_worker', 'public.training_profiles', 'SELECT')
         AND NOT has_table_privilege('replay_worker', 'public.training_profiles', 'UPDATE')
         AND has_table_privilege('replay_worker', 'public.training_days', 'SELECT')
         AND has_column_privilege('replay_worker', 'public.training_days', 'plan', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.training_days', 'bankReviewed', 'UPDATE')
  UNION ALL
  SELECT 'housekeeping on sessions: status and endedAt, the 90-day prune; never items or the owner',
         has_table_privilege('replay_worker', 'public.training_sessions', 'SELECT, DELETE')
         AND has_column_privilege('replay_worker', 'public.training_sessions', 'status', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.training_sessions', 'items', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.training_sessions', 'userId', 'UPDATE')
  UNION ALL
  SELECT 'marks extracted game sides (bankVersion only, never result)',
         has_column_privilege('replay_worker', 'public.game_players', 'bankVersion', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.game_players', 'result', 'UPDATE')
  UNION ALL
  SELECT 'no access to training_attempts or reports',
         NOT has_table_privilege('replay_worker', 'public.training_attempts', 'SELECT')
         AND NOT has_table_privilege('replay_worker', 'public.training_attempts', 'INSERT')
         AND NOT has_table_privilege('replay_worker', 'public.reports', 'SELECT')
  UNION ALL
  SELECT 'job-load inputs: the member''s zone (P4) and the opt-out list (P3)',
         has_column_privilege('replay_worker', 'public.users', 'timeZone', 'SELECT')
         AND has_table_privilege('replay_worker', 'public.player_reviews', 'SELECT')
) checks;

\else
  \echo 'replay_worker does not exist on this database: nothing changed'
\endif
