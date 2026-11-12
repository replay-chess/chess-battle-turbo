-- replay_worker: the analysis worker's least-privilege role (phase-03 plan 6.3, 6.7 step 5). The worker talks to
-- Neon over the HTTP driver (P3-D11) and can do exactly the analysis pipeline, LEGEND_COMPARE and HOUSEKEEPING:
-- no emails, no billing columns, no games.moves/openingId writes, no DDL, no TRUNCATE, DELETE only where a
-- HOUSEKEEPING slice prunes.
--
-- Not a Prisma migration: roles are cluster objects, and Neon keeps roles per branch. Run it as the branch owner
-- (the DIRECT_URL user), AFTER `prisma migrate deploy` has applied M3 (20261111000000_m3_analysis_review), on the
-- Neon `dev` branch (project withered-cake-82837167, endpoint ep-fancy-dust-b8b3dp81); P13 repeats it on
-- production. Never on the old project shy-morning-50748774. Check the host first, exactly as in
-- scripts/db/README.md ("replay_app" step 2), then:
--
--   WK_PASSWORD="$(openssl rand -hex 24)"
--   psql "$OWNER_DIRECT_URL" -v ON_ERROR_STOP=1 -v wk_password="$WK_PASSWORD" -f packages/db/scripts/roles/replay_worker.sql
--
-- Create the role with SQL, not in the Neon console (console roles join neon_superuser). Store the password only in
-- the worker's env file (GitHub secret WORKER_DEV_ENV_FILE, and the gitignored apps/analysis-worker/.env.local-dev),
-- as WORKER_DATABASE_URL:
--   postgresql://replay_worker:<WK_PASSWORD>@ep-fancy-dust-b8b3dp81-pooler.c-14.us-east-1.aws.neon.tech/neondb?sslmode=require
--
-- Guarded (plan 6.3): without the role and without -v wk_password the script changes nothing and says so (CI's
-- Docker Postgres and fresh branches have no replay_worker until someone creates it). Idempotent: an existing role
-- keeps its password (rotate with ALTER ROLE … PASSWORD); grants and settings are re-applied. Column grants are
-- explicit, so run it again after a migration that adds a column the worker must read or write.
--
-- Deliberately narrower than the plan's draft list (least privilege):
--   * users: SELECT on (id, "referenceId", name, "gamesVersion") only, never the whole row (email, googleId and
--     the billing columns are PII the worker never needs);
--   * no ALTER DEFAULT PRIVILEGES … GRANT SELECT ON TABLES: later phases add PII tables (P4 linked_accounts,
--     audit_logs), so each phase grants the worker exactly the tables it reads, in its own roles file;
--   * shares: SELECT on (id, code, kind, "expiresAt", "revokedAt") only, the columns the prune reads, never the
--     snapshot JSON with the sharer's name;
--   * rate_limit_windows gets the same SELECT + DELETE as rate_limit_buckets, because the HOUSEKEEPING
--     prune-rate-limits slice takes over P1's whole rate-limit-sweep cron (both tables).

\set ON_ERROR_STOP on
\set QUIET on

SELECT current_database() AS target_db, current_user AS owner_role \gset
\echo 'target database:' :target_db ' owner role:' :owner_role

-- M3 must be applied first (the grants name its tables).
SELECT to_regclass('public.jobs') IS NOT NULL AND to_regclass('public.game_analyses') IS NOT NULL AS m3_applied \gset
\if :m3_applied
\else
  DO $$ BEGIN RAISE EXCEPTION 'M3 is not applied on this database: run prisma migrate deploy first'; END $$;
\endif

-- 1. The role (LOGIN, no other attributes). Guard: no role and no password = nothing to do.
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replay_worker') AS role_exists \gset
\if :role_exists
  \echo 'replay_worker exists: password unchanged'
\else
  \if :{?wk_password}
    SELECT format(
      'CREATE ROLE replay_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION PASSWORD %L',
      :'wk_password'
    ) \gexec
    \echo 'replay_worker created'
  \else
    \echo 'replay_worker does not exist and no -v wk_password was given: nothing changed'
  \endif
\endif

SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replay_worker') AS role_ready \gset
\if :role_ready

-- 2. Timeouts (plan 6.7 step 5). A pass-2 search never holds a statement open: every statement is a short upsert,
--    sent over HTTP with no interactive transaction.
ALTER ROLE replay_worker SET statement_timeout = '60s';
ALTER ROLE replay_worker SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE replay_worker SET lock_timeout = '5s';

-- 3. Grants (plan 6.3, narrowed as described in the header).
SELECT format('GRANT CONNECT ON DATABASE %I TO replay_worker', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO replay_worker;

-- Reads.
GRANT SELECT (id, "referenceId", name, "gamesVersion") ON users TO replay_worker;
GRANT SELECT ON games, game_players, openings, chess_positions TO replay_worker;
-- shares: only what the HOUSEKEEPING prune-shares slice filters on, never the snapshot (sharer names, the masked
-- review) or the owner. REVOKE first, so a re-run narrows a role that had the whole table (FIX-2).
REVOKE SELECT ON shares FROM replay_worker;
GRANT SELECT (id, code, kind, "expiresAt", "revokedAt") ON shares TO replay_worker;
-- The legend comparison's historical name is the linked legends record's name (the rule every facts writer shares,
-- @repo/chess-analysis/legend/facts): only the id and the name, never the rest of the record.
GRANT SELECT (id, name) ON legends TO replay_worker;
GRANT SELECT ON rate_limit_buckets, rate_limit_windows TO replay_worker;

-- The worker's own tables (pipeline, checkpoints, reviews, legend READY, queue claim/reaper/fail/prune).
GRANT SELECT, INSERT, UPDATE, DELETE ON jobs, game_analyses, player_reviews, legend_comparisons TO replay_worker;
GRANT USAGE, SELECT ON SEQUENCE jobs_id_seq TO replay_worker;          -- DAILY_PLAN and regrade-sweep inserts

-- Narrow writes on rows other writers own.
GRANT UPDATE ("analysisStatus", "ecoCode", "openingName", "updatedAt") ON games TO replay_worker;   -- never openingId
GRANT UPDATE (accuracy, headline, "momentsCount", counts, "phaseAccuracy", "ecoCode", "updatedAt")
  ON game_players TO replay_worker;
GRANT UPDATE ("gamesVersion") ON users TO replay_worker;               -- the done/fail batch bump (P3-D27)

-- HOUSEKEEPING prunes only.
GRANT DELETE ON shares, rate_limit_buckets, rate_limit_windows TO replay_worker;

-- 4. Verification: every row must say ok = true.
\set QUIET off
SELECT check_name, ok FROM (
  SELECT 'role can log in, has no elevated attributes' AS check_name,
         rolcanlogin AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication) AS ok
    FROM pg_roles WHERE rolname = 'replay_worker'
  UNION ALL
  SELECT 'member of no other role (e.g. neon_superuser)',
         NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'replay_worker')
  UNION ALL
  SELECT 'no CREATE on schema public', NOT has_schema_privilege('replay_worker', 'public', 'CREATE')
  UNION ALL
  SELECT 'cannot read users.email or users.googleId',
         NOT has_column_privilege('replay_worker', 'public.users', 'email', 'SELECT')
         AND NOT has_column_privilege('replay_worker', 'public.users', 'googleId', 'SELECT')
  UNION ALL
  SELECT 'cannot read users billing (subscriptionStatus, dodoCustomerId)',
         NOT has_column_privilege('replay_worker', 'public.users', 'subscriptionStatus', 'SELECT')
         AND NOT has_column_privilege('replay_worker', 'public.users', 'dodoCustomerId', 'SELECT')
  UNION ALL
  SELECT 'cannot write games.moves, games.status or games.openingId',
         NOT has_column_privilege('replay_worker', 'public.games', 'moves', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.games', 'status', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.games', 'openingId', 'UPDATE')
  UNION ALL
  SELECT 'cannot write game_players.result',
         NOT has_column_privilege('replay_worker', 'public.game_players', 'result', 'UPDATE')
  UNION ALL
  SELECT 'cannot insert games or game_players',
         NOT has_table_privilege('replay_worker', 'public.games', 'INSERT')
         AND NOT has_table_privilege('replay_worker', 'public.game_players', 'INSERT')
  UNION ALL
  SELECT 'reads legends.id and legends.name only',
         has_column_privilege('replay_worker', 'public.legends', 'name', 'SELECT')
         AND has_column_privilege('replay_worker', 'public.legends', 'id', 'SELECT')
         AND NOT has_table_privilege('replay_worker', 'public.legends', 'SELECT')
         AND NOT has_column_privilege('replay_worker', 'public.legends', 'achievements', 'SELECT')
  UNION ALL
  SELECT 'can run the pipeline (jobs, game_analyses, player_reviews, legend_comparisons)',
         has_table_privilege('replay_worker', 'public.jobs', 'SELECT, INSERT, UPDATE, DELETE')
         AND has_table_privilege('replay_worker', 'public.game_analyses', 'SELECT, INSERT, UPDATE')
         AND has_table_privilege('replay_worker', 'public.player_reviews', 'SELECT, INSERT, UPDATE')
         AND has_table_privilege('replay_worker', 'public.legend_comparisons', 'SELECT, UPDATE')
         AND has_sequence_privilege('replay_worker', 'public.jobs_id_seq', 'USAGE')
  UNION ALL
  SELECT 'can write the analysis columns and the gamesVersion bump',
         has_column_privilege('replay_worker', 'public.games', 'analysisStatus', 'UPDATE')
         AND has_column_privilege('replay_worker', 'public.game_players', 'accuracy', 'UPDATE')
         AND has_column_privilege('replay_worker', 'public.users', 'gamesVersion', 'UPDATE')
  UNION ALL
  SELECT 'DELETE only on the queue, analysis tables and the pruned tables',
         NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                        AND has_table_privilege('replay_worker', c.oid, 'DELETE')
                        AND c.relname NOT IN ('jobs', 'game_analyses', 'player_reviews', 'legend_comparisons',
                                              'shares', 'rate_limit_buckets', 'rate_limit_windows'))
  UNION ALL
  SELECT 'reads shares (id, code, kind, expiresAt, revokedAt) only, never the snapshot or the owner',
         has_column_privilege('replay_worker', 'public.shares', 'expiresAt', 'SELECT')
         AND has_column_privilege('replay_worker', 'public.shares', 'kind', 'SELECT')
         AND NOT has_table_privilege('replay_worker', 'public.shares', 'SELECT')
         AND NOT has_column_privilege('replay_worker', 'public.shares', 'snapshot', 'SELECT')
         AND NOT has_column_privilege('replay_worker', 'public.shares', 'ownerId', 'SELECT')
  UNION ALL
  SELECT 'no TRUNCATE anywhere',
         NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                        AND has_table_privilege('replay_worker', c.oid, 'TRUNCATE'))
  UNION ALL
  SELECT 'no access to _prisma_migrations',
         to_regclass('public._prisma_migrations') IS NULL
         OR NOT has_table_privilege('replay_worker', 'public._prisma_migrations', 'SELECT')
  UNION ALL
  SELECT 'timeouts set',
         (SELECT count(*) FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole, unnest(s.setconfig) c
           WHERE r.rolname = 'replay_worker' AND s.setdatabase = 0
             AND split_part(c, '=', 1) IN ('statement_timeout', 'idle_in_transaction_session_timeout', 'lock_timeout')) = 3
) checks;

\endif
