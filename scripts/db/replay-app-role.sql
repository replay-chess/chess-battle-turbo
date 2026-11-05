-- replay_app: the DML-only runtime role behind DATABASE_URL (phase-01 plan §6.4–6.5, 1B·F9; audit-db §5.4 DB-17).
--
-- Not a Prisma migration: roles are cluster objects, and Neon keeps roles per branch. Run it once per
-- branch, as that branch's owner role (the DIRECT_URL user), and only after the owner has confirmed (Q-05).
-- scripts/db/README.md has the full procedure, the target check and the rollback. Never run it against the
-- Neon `production` branch in P1 (that switch belongs to P13) or against the old project.
--
--   psql "$OWNER_DIRECT_URL" -v ON_ERROR_STOP=1 -v app_password="$APP_PASSWORD" -f scripts/db/replay-app-role.sql
--
-- Idempotent: an existing replay_app keeps its password (rotate it with ALTER ROLE, README §6); the grants,
-- default privileges and timeouts are re-applied. `app_password` is only needed when the role is created.
-- psql does not interpolate variables inside $$ bodies, so the guarded CREATE ROLE is built with format(%L)
-- and run with \gexec (the same effect as a DO $$ … IF NOT EXISTS block, without the password in the body).

\set ON_ERROR_STOP on
\set QUIET on

SELECT current_database() AS target_db, current_user AS owner_role \gset
\echo 'target database:' :target_db ' owner role:' :owner_role

-- 1. The role (LOGIN, no other attributes: NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS).
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replay_app') AS role_exists \gset
\if :role_exists
  \echo 'replay_app exists: password unchanged'
\else
  \if :{?app_password}
  \else
    DO $$ BEGIN RAISE EXCEPTION 'replay_app does not exist yet: pass -v app_password=<generated, e.g. openssl rand -hex 24>'; END $$;
  \endif
  SELECT format(
    'CREATE ROLE replay_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION PASSWORD %L',
    :'app_password'
  ) \gexec
  \echo 'replay_app created'
\endif

-- 2. Data access: SELECT/INSERT/UPDATE/DELETE on every table, sequences for defaults. No TRUNCATE, no
--    REFERENCES/TRIGGER, no DDL (CREATE on the schema is never granted; PostgreSQL 15+ no longer gives it
--    to PUBLIC).
SELECT format('GRANT CONNECT ON DATABASE %I TO replay_app', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO replay_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO replay_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO replay_app;

-- Migration history belongs to the owner (prisma migrate runs on DIRECT_URL only).
SELECT 'REVOKE ALL ON TABLE public._prisma_migrations FROM replay_app'
WHERE to_regclass('public._prisma_migrations') IS NOT NULL \gexec

-- 3. Tables and sequences the owner creates later (every future migration) get the same grants.
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO replay_app',
  current_user
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO replay_app',
  current_user
) \gexec

-- 4. Timeouts (DB-17): a runaway statement or an abandoned transaction cannot hold locks for minutes.
ALTER ROLE replay_app SET statement_timeout = '15s';
ALTER ROLE replay_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE replay_app SET lock_timeout = '5s';

-- 5. Verification: every row must say ok = true.
\set QUIET off
SELECT check_name, ok FROM (
  SELECT 'role can log in, has no elevated attributes' AS check_name,
         rolcanlogin AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication) AS ok
    FROM pg_roles WHERE rolname = 'replay_app'
  UNION ALL
  SELECT 'member of no other role (e.g. neon_superuser)',
         NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'replay_app')
  UNION ALL
  SELECT 'no CREATE on schema public', NOT has_schema_privilege('replay_app', 'public', 'CREATE')
  UNION ALL
  SELECT 'DML on users', has_table_privilege('replay_app', 'public.users', 'SELECT, INSERT, UPDATE, DELETE')
  UNION ALL
  SELECT 'no TRUNCATE on any table',
         NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                        AND has_table_privilege('replay_app', c.oid, 'TRUNCATE'))
  UNION ALL
  SELECT 'DML on every application table',
         NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> '_prisma_migrations'
                        AND NOT has_table_privilege('replay_app', c.oid, 'SELECT, INSERT, UPDATE, DELETE'))
  UNION ALL
  SELECT 'no access to _prisma_migrations',
         to_regclass('public._prisma_migrations') IS NULL
         OR NOT has_table_privilege('replay_app', 'public._prisma_migrations', 'SELECT')
  UNION ALL
  SELECT 'timeouts set',
         (SELECT count(*) FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole, unnest(s.setconfig) c
           WHERE r.rolname = 'replay_app' AND s.setdatabase = 0
             AND split_part(c, '=', 1) IN ('statement_timeout', 'idle_in_transaction_session_timeout', 'lock_timeout')) = 3
) checks;
