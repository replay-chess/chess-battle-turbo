-- replay_app (web) grants for M4 (phase-04 plan 6.1-6.3, 7.2-7.5). P1's scripts/db/replay-app-role.sql gives
-- replay_app DML on every table through ALTER DEFAULT PRIVILEGES FOR ROLE <owner>, so on a branch where the same owner
-- ran both that script and `prisma migrate deploy` this file only re-states and verifies what the web needs; the
-- explicit grants make the web work when the M4 tables were created by another role. Run it as the branch owner after
-- `prisma migrate deploy` has applied M4, on the Neon `dev` branch (ep-fancy-dust-b8b3dp81) or a local/CI Postgres;
-- never on the old project shy-morning-50748774:
--
--   psql "$OWNER_DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/db/scripts/roles/replay_app.p4.sql
--
-- Guarded: without a replay_app role it changes nothing and says so. Idempotent. The web does not purge games (the
-- worker's import_purge_batch() does), so it gets no EXECUTE on that function.

\set ON_ERROR_STOP on
\set QUIET on

SELECT current_database() AS target_db, current_user AS owner_role \gset
\echo 'target database:' :target_db ' owner role:' :owner_role

SELECT to_regclass('public.linked_accounts') IS NOT NULL AND to_regclass('public.trial_ledger') IS NOT NULL AS m4_applied \gset
\if :m4_applied
\else
  DO $$ BEGIN RAISE EXCEPTION 'M4 is not applied on this database: run prisma migrate deploy first'; END $$;
\endif

SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replay_app') AS role_ready \gset
\if :role_ready

-- Link, sync, auto-import, unlink (ACC-3…6), the Lichess callback, import status / retry, the entitlement release,
-- the daily prune (P22/P23).
GRANT SELECT, INSERT, UPDATE, DELETE ON linked_accounts, import_cursors, import_runs TO replay_app;
GRANT USAGE, SELECT ON SEQUENCE linked_accounts_id_seq, import_runs_id_seq TO replay_app;
-- The trial ledger (checkout eligibility, the first trialing snapshot); P10's deletion keeps the rows.
GRANT SELECT, INSERT, UPDATE ON trial_ledger TO replay_app;
-- audit(): inserts; P12's admin feed reads.
GRANT SELECT, INSERT ON audit_logs TO replay_app;
GRANT USAGE, SELECT ON SEQUENCE audit_logs_id_seq TO replay_app;
-- Unlink and the auto-import switch remove the account's QUEUED import job (7.3.7, 7.3.8).
GRANT DELETE ON jobs TO replay_app;
-- Onboarding, the zone and the billing columns P4 writes.
GRANT UPDATE ("onboardingStep", "onboardedAt", onboarded, "ratingBand", "ratingBandSource", "initialRating", goals,
              "dailyMinutes", "signupSource", "timeZone", "trialOfferedAt", "pendingCheckoutSessionId",
              "pendingCheckoutPlan", "pendingCheckoutAt", "pendingCheckoutUrl", "lastCheckoutSource", "membershipEndedAt",
              "lastPaymentFailedAt", "lastPaymentFailureReason", "updatedAt") ON users TO replay_app;   -- pendingCheckoutUrl: m4r

\set QUIET off
SELECT check_name, ok FROM (
  SELECT 'links, runs and cursors' AS check_name,
         has_table_privilege('replay_app', 'public.linked_accounts', 'SELECT, INSERT, UPDATE, DELETE')
         AND has_table_privilege('replay_app', 'public.import_runs', 'SELECT, INSERT, UPDATE, DELETE')
         AND has_table_privilege('replay_app', 'public.import_cursors', 'SELECT, INSERT, UPDATE, DELETE')
         AND has_sequence_privilege('replay_app', 'public.import_runs_id_seq', 'USAGE') AS ok
  UNION ALL
  SELECT 'trial ledger and audit log',
         has_table_privilege('replay_app', 'public.trial_ledger', 'SELECT, INSERT, UPDATE')
         AND has_table_privilege('replay_app', 'public.audit_logs', 'INSERT')
  UNION ALL
  SELECT 'writes the onboarding and billing columns',
         has_column_privilege('replay_app', 'public.users', 'onboardingStep', 'UPDATE')
         AND has_column_privilege('replay_app', 'public.users', 'pendingCheckoutAt', 'UPDATE')
         AND has_column_privilege('replay_app', 'public.users', 'pendingCheckoutUrl', 'UPDATE')
         AND has_column_privilege('replay_app', 'public.users', 'timeZone', 'UPDATE')
  UNION ALL
  SELECT 'removes queued import jobs', has_table_privilege('replay_app', 'public.jobs', 'DELETE')
  UNION ALL
  SELECT 'cannot run the purge function', NOT has_function_privilege('replay_app', 'import_purge_batch(bigint, "GameSource", integer)', 'EXECUTE')
) checks;

\else
  \echo 'replay_app does not exist on this database: nothing changed'
\endif
