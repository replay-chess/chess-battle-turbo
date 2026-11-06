-- replay_realtime: the socket server's least-privilege role (phase-02 plan 6.7). The socket writes live games
-- straight to Neon through @repo/db/live (B4); this role can do exactly that and nothing else: no emails, no billing
-- columns, no gameData, no DDL, no DELETE, no TRUNCATE.
--
-- Not a Prisma migration: roles are cluster objects, and Neon keeps roles per branch. Run it as the branch owner
-- (the DIRECT_URL user) on the Neon `dev` branch (project withered-cake-82837167, endpoint ep-fancy-dust-b8b3dp81);
-- P13 repeats it on production. Never on the old project shy-morning-50748774. Check the host first, exactly as in
-- scripts/db/README.md ("replay_app" step 2), then:
--
--   RT_PASSWORD="$(openssl rand -hex 24)"
--   psql "$OWNER_DIRECT_URL" -v ON_ERROR_STOP=1 -v rt_password="$RT_PASSWORD" -f packages/db/sql/roles.sql
--
-- Create the role with SQL, not in the Neon console (console roles join neon_superuser). Store the password only in
-- the OCI env file (GitHub secret WS_DEV_ENV_FILE), as the socket's pooled DATABASE_URL:
--   postgresql://replay_realtime:<RT_PASSWORD>@ep-fancy-dust-b8b3dp81-pooler.c-14.us-east-1.aws.neon.tech/neondb
--     ?sslmode=require&pgbouncer=true&connection_limit=3&pool_timeout=10&connect_timeout=15
--
-- Idempotent: an existing role keeps its password (rotate with ALTER ROLE … PASSWORD); grants and settings are
-- re-applied. Run it again after a migration that adds a column the socket must read (column grants are explicit).

\set ON_ERROR_STOP on
\set QUIET on

SELECT current_database() AS target_db, current_user AS owner_role \gset
\echo 'target database:' :target_db ' owner role:' :owner_role

-- 1. The role (LOGIN, no other attributes).
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replay_realtime') AS role_exists \gset
\if :role_exists
  \echo 'replay_realtime exists: password unchanged'
\else
  \if :{?rt_password}
  \else
    DO $$ BEGIN RAISE EXCEPTION 'replay_realtime does not exist yet: pass -v rt_password=<generated, e.g. openssl rand -hex 24>'; END $$;
  \endif
  SELECT format(
    'CREATE ROLE replay_realtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION PASSWORD %L',
    :'rt_password'
  ) \gexec
  \echo 'replay_realtime created'
\endif

-- 2. Timeouts (plan 6.7): a checkpoint is one short statement; no transaction ever waits on a socket event.
ALTER ROLE replay_realtime SET statement_timeout = '5s';
ALTER ROLE replay_realtime SET lock_timeout = '3s';
ALTER ROLE replay_realtime SET idle_in_transaction_session_timeout = '10s';

-- 3. Grants (plan 6.7). Column lists are explicit: the role never reads emails, billing columns or gameData.
SELECT format('GRANT CONNECT ON DATABASE %I TO replay_realtime', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO replay_realtime;
GRANT SELECT (id, "referenceId", name, "profilePictureUrl", role, "gamesVersion") ON users TO replay_realtime;
GRANT UPDATE ("gamesVersion") ON users TO replay_realtime;                 -- the finish CTE bump only
GRANT SELECT ("userId", "bulletRating", "blitzRating", "rapidRating") ON chess_com_profiles TO replay_realtime;
-- games: every column except the legacy gameData blob (loadLiveGame and the live writers never touch it).
SELECT format('GRANT SELECT (%s) ON games TO replay_realtime',
              string_agg(quote_ident(attname), ', ' ORDER BY attnum))
  FROM pg_attribute WHERE attrelid = 'public.games'::regclass AND attnum > 0 AND NOT attisdropped AND attname <> 'gameData' \gexec
GRANT INSERT, UPDATE ON games TO replay_realtime;                          -- rematch insert, checkpoint, finish, abort
GRANT SELECT, INSERT, UPDATE ON game_players TO replay_realtime;
GRANT USAGE ON SEQUENCE games_id_seq TO replay_realtime;                   -- the rematch INSERT (bigserial id)
GRANT SELECT, UPDATE ON user_stats, tournament_participants TO replay_realtime;
GRANT SELECT (id, "referenceId", name) ON tournaments TO replay_realtime;

-- 4. Verification: every row must say ok = true.
\set QUIET off
SELECT check_name, ok FROM (
  SELECT 'role can log in, has no elevated attributes' AS check_name,
         rolcanlogin AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication) AS ok
    FROM pg_roles WHERE rolname = 'replay_realtime'
  UNION ALL
  SELECT 'member of no other role (e.g. neon_superuser)',
         NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'replay_realtime')
  UNION ALL
  SELECT 'no CREATE on schema public', NOT has_schema_privilege('replay_realtime', 'public', 'CREATE')
  UNION ALL
  SELECT 'cannot read users.email', NOT has_column_privilege('replay_realtime', 'public.users', 'email', 'SELECT')
  UNION ALL
  SELECT 'cannot read users billing (subscriptionStatus)',
         NOT has_column_privilege('replay_realtime', 'public.users', 'subscriptionStatus', 'SELECT')
  UNION ALL
  SELECT 'cannot read games.gameData', NOT has_column_privilege('replay_realtime', 'public.games', 'gameData', 'SELECT')
  UNION ALL
  SELECT 'can write games and game_players',
         has_table_privilege('replay_realtime', 'public.games', 'INSERT, UPDATE')
         AND has_table_privilege('replay_realtime', 'public.game_players', 'SELECT, INSERT, UPDATE')
  UNION ALL
  SELECT 'no DELETE or TRUNCATE anywhere',
         NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                        AND (has_table_privilege('replay_realtime', c.oid, 'DELETE')
                             OR has_table_privilege('replay_realtime', c.oid, 'TRUNCATE')))
  UNION ALL
  SELECT 'timeouts set',
         (SELECT count(*) FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole, unnest(s.setconfig) c
           WHERE r.rolname = 'replay_realtime' AND s.setdatabase = 0
             AND split_part(c, '=', 1) IN ('statement_timeout', 'idle_in_transaction_session_timeout', 'lock_timeout')) = 3
) checks;
