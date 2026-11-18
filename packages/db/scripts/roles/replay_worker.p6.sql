-- replay_worker grants for M6 (phase-06 plan 6.2.3, 7.4, 11): the weakness inputs in the final analysis batch and the
-- heal, the RECOMPUTE_WEAKNESS job (snapshot upsert, version bump) and the daily slice (weekly roll, heal sweep,
-- prune). Run it after replay_worker.sql (which creates the role and the P3 grants), replay_worker.p4.sql,
-- replay_worker.p5.sql, and after `prisma migrate deploy` has applied M6 (20261117000000_m6_weakness), on the Neon
-- `dev` branch (ep-fancy-dust-b8b3dp81) or a local/CI Postgres; P13 repeats it on production. Never on
-- shy-morning-50748774.
--
--   psql "$OWNER_DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/db/scripts/roles/replay_worker.p6.sql
--
-- Guarded: without a replay_worker role it changes nothing and says so. Idempotent. Least privilege, as the P3-P5 files:
--   * game_players: UPDATE of the five input columns only ("stats", "errorThemes", "errorLog", "errorThemeN",
--     "weaknessInputsV"); never result, rating or the import columns;
--   * weakness_snapshots: SELECT, INSERT, UPDATE, DELETE (the Q-W10 upsert, the 12-week prune of the daily slice);
--   * training_profiles: P5 granted SELECT; P6 adds the version bump only: INSERT ("userId", "weaknessVersion",
--     "updatedAt") and UPDATE ("weaknessVersion", "updatedAt"). "updatedAt" is NOT NULL without a default (Prisma
--     @updatedAt), so the bump's INSERT … ON CONFLICT must write it. Never the member's prefs, scope or seen counter;
--   * training_attempts: SELECT ("userId", "reviewedAt") only, for the weekly roll's "trained this week" probe (Q-W13);
--     never the attempt content (the FSRS log, the moves);
--   * users: SELECT ("ratingBand"), the onboarding fallback of the rating band (plan 8.4); P4 granted the zone and the
--     entitlement columns;
--   * mistakes: P5's table-level UPDATE already covers "themes" (the J1 rc:timePressure tag); verified below;
--   * no DELETE on game_players, training_profiles or mistakes.

\set ON_ERROR_STOP on
\set QUIET on

SELECT current_database() AS target_db, current_user AS owner_role \gset
\echo 'target database:' :target_db ' owner role:' :owner_role

SELECT to_regclass('public.weakness_snapshots') IS NOT NULL AND EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'game_players' AND column_name = 'weaknessInputsV')
       AND EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'training_profiles' AND column_name = 'weaknessVersion') AS m6_applied \gset
\if :m6_applied
\else
  DO $$ BEGIN RAISE EXCEPTION 'M6 is not applied on this database: run prisma migrate deploy first'; END $$;
\endif

SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replay_worker') AS role_ready \gset
\if :role_ready

-- The per-side inputs: the final analysis batch, the heal of rows with weaknessInputsV = 0, the regrade refresh.
GRANT UPDATE ("stats", "errorThemes", "errorLog", "errorThemeN", "weaknessInputsV") ON game_players TO replay_worker;

-- RECOMPUTE_WEAKNESS: the snapshot upsert (Q-W10) and the prune (Q-W11).
GRANT SELECT, INSERT, UPDATE, DELETE ON weakness_snapshots TO replay_worker;

-- The version bump (plan 8.16): INSERT … ON CONFLICT ("userId") DO UPDATE SET "weaknessVersion", "updatedAt".
GRANT INSERT ("userId", "weaknessVersion", "updatedAt") ON training_profiles TO replay_worker;
GRANT UPDATE ("weaknessVersion", "updatedAt") ON training_profiles TO replay_worker;

-- The daily slice's activity probe (Q-W13).
GRANT SELECT ("userId", "reviewedAt") ON training_attempts TO replay_worker;

-- The rating band's onboarding fallback (plan 8.4).
GRANT SELECT ("ratingBand") ON users TO replay_worker;

\set QUIET off
SELECT check_name, ok FROM (
  SELECT 'writes the five weakness input columns, nothing else new on game_players' AS check_name,
         has_column_privilege('replay_worker', 'public.game_players', 'stats', 'UPDATE')
         AND has_column_privilege('replay_worker', 'public.game_players', 'errorThemes', 'UPDATE')
         AND has_column_privilege('replay_worker', 'public.game_players', 'errorLog', 'UPDATE')
         AND has_column_privilege('replay_worker', 'public.game_players', 'errorThemeN', 'UPDATE')
         AND has_column_privilege('replay_worker', 'public.game_players', 'weaknessInputsV', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.game_players', 'result', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.game_players', 'ratingBefore', 'UPDATE')
         AND NOT has_table_privilege('replay_worker', 'public.game_players', 'DELETE') AS ok
  UNION ALL
  SELECT 'upserts and prunes weakness snapshots',
         has_table_privilege('replay_worker', 'public.weakness_snapshots', 'SELECT, INSERT, UPDATE, DELETE')
  UNION ALL
  SELECT 'bumps weaknessVersion (with updatedAt); never the prefs, the scope or the seen counter',
         has_table_privilege('replay_worker', 'public.training_profiles', 'SELECT')
         AND has_column_privilege('replay_worker', 'public.training_profiles', 'weaknessVersion', 'INSERT')
         AND has_column_privilege('replay_worker', 'public.training_profiles', 'updatedAt', 'INSERT')
         AND has_column_privilege('replay_worker', 'public.training_profiles', 'weaknessVersion', 'UPDATE')
         AND has_column_privilege('replay_worker', 'public.training_profiles', 'updatedAt', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.training_profiles', 'lastWeaknessSeenVersion', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.training_profiles', 'weaknessTimeClasses', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.training_profiles', 'weaknessMonths', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.training_profiles', 'bankDailyCap', 'UPDATE')
         AND NOT has_table_privilege('replay_worker', 'public.training_profiles', 'UPDATE')
         AND NOT has_table_privilege('replay_worker', 'public.training_profiles', 'DELETE')
  UNION ALL
  SELECT 'reads only who trained when from training_attempts',
         has_column_privilege('replay_worker', 'public.training_attempts', 'userId', 'SELECT')
         AND has_column_privilege('replay_worker', 'public.training_attempts', 'reviewedAt', 'SELECT')
         AND NOT has_table_privilege('replay_worker', 'public.training_attempts', 'SELECT')
         AND NOT has_table_privilege('replay_worker', 'public.training_attempts', 'INSERT')
  UNION ALL
  SELECT 'reads the inputs: games, analyses, mistakes, cards, links, the zone and the rating band',
         has_table_privilege('replay_worker', 'public.games', 'SELECT')
         AND has_table_privilege('replay_worker', 'public.game_players', 'SELECT')
         AND has_table_privilege('replay_worker', 'public.game_analyses', 'SELECT')
         AND has_table_privilege('replay_worker', 'public.mistakes', 'SELECT')
         AND has_table_privilege('replay_worker', 'public.training_cards', 'SELECT')
         AND has_table_privilege('replay_worker', 'public.linked_accounts', 'SELECT')
         AND has_column_privilege('replay_worker', 'public.users', 'timeZone', 'SELECT')
         AND has_column_privilege('replay_worker', 'public.users', 'ratingBand', 'SELECT')
         AND NOT has_column_privilege('replay_worker', 'public.users', 'email', 'SELECT')
  UNION ALL
  SELECT 'tags bank mistakes (themes) without deleting them',
         has_column_privilege('replay_worker', 'public.mistakes', 'themes', 'UPDATE')
         AND NOT has_table_privilege('replay_worker', 'public.mistakes', 'DELETE')
  UNION ALL
  SELECT 'enqueues and completes its jobs',
         has_table_privilege('replay_worker', 'public.jobs', 'SELECT, INSERT, UPDATE')
         AND has_sequence_privilege('replay_worker', 'public.jobs_id_seq', 'USAGE')
) checks;

\else
  \echo 'replay_worker does not exist on this database: nothing changed'
\endif
