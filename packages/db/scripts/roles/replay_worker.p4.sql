-- replay_worker grants for M4 (phase-04 plan 6.1-6.3, 7.7, 8.6-8.12): the IMPORT_SYNC / IMPORT_PURGE handlers on the
-- worker's I/O lane. Run it after replay_worker.sql (which creates the role and the P3 grants) and after
-- `prisma migrate deploy` has applied M4 (20261112000100_m4_import_onboarding), on the Neon `dev` branch
-- (ep-fancy-dust-b8b3dp81) or a local/CI Postgres; P13 repeats it on production. Never on shy-morning-50748774.
--
--   psql "$OWNER_DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/db/scripts/roles/replay_worker.p4.sql
--
-- Guarded: without a replay_worker role it changes nothing and says so. Idempotent. Least privilege, as P3's file:
--   * users: SELECT on the columns the entitlement check and the schedule read (status, period end, trial dates,
--     role, time zone), never email, googleId, dodoCustomerId or subscriptionId;
--   * games / game_players: INSERT on exactly the batch writer's columns (8.8; never pgn, gameData, meta, openingId),
--     UPDATE on the player ids the conflict arm fills; NO DELETE: the purge runs through import_purge_batch()
--     (SECURITY DEFINER, IMPORTED rows only), so M3's "the worker cannot delete games" stays true;
--   * the import tables: what the run needs, no DELETE (the web unlinks; the daily cron prunes runs);
--   * audit_logs: INSERT only (`account.purged`), never SELECT.

\set ON_ERROR_STOP on
\set QUIET on

SELECT current_database() AS target_db, current_user AS owner_role \gset
\echo 'target database:' :target_db ' owner role:' :owner_role

SELECT to_regclass('public.linked_accounts') IS NOT NULL AND to_regclass('public.import_runs') IS NOT NULL
       AND to_regprocedure('public.import_purge_batch(bigint, "GameSource", integer)') IS NOT NULL AS m4_applied \gset
\if :m4_applied
\else
  DO $$ BEGIN RAISE EXCEPTION 'M4 is not applied on this database: run prisma migrate deploy first'; END $$;
\endif

SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replay_worker') AS role_ready \gset
\if :role_ready

-- Run start (loadImportContext, 8.9): the member's billing state and zone.
GRANT SELECT ("subscriptionStatus", "currentPeriodEnd", "cancelAtPeriodEnd", "trialStartedAt", "trialEndsAt", role,
              "timeZone") ON users TO replay_worker;

-- The import tables. UPDATE on the columns the run statements write only (FIX-2, review round 2: table-wide UPDATE let a
-- compromised worker move a link to another user or mark it verified). Never userId, provider, username,
-- usernameLower, verifiedAt, autoImport, timeZone or createdAt on linked_accounts; never the run's owner, account,
-- provider, trigger or reference. The table-wide grant of earlier runs of this file is revoked first (idempotent).
REVOKE UPDATE ON linked_accounts, import_cursors, import_runs FROM replay_worker;
GRANT SELECT ON linked_accounts TO replay_worker;
GRANT UPDATE (status, "importState", "lastSyncAt", "lastSyncOkAt", "nextAutoSyncAt", "nextAllowedSyncAt", "lastError",
              "skippedCount", "importedCount", title, "avatarUrl", "externalId", "updatedAt")
  ON linked_accounts TO replay_worker;                                  -- externalId: only while unverified (run.ts)
GRANT SELECT, INSERT ON import_cursors TO replay_worker;
GRANT UPDATE ("archivesEtag", "archivesLastModified", archives, "lichessSinceMs", "lichessResumeUntilMs",
              "oldestImportedAt", seen, "skippedVariants", "updatedAt")
  ON import_cursors TO replay_worker;
GRANT SELECT, INSERT ON import_runs TO replay_worker;                   -- DAILY runs are inserted by the worker
GRANT UPDATE (status, phase, "startedAt", "finishedAt", error, total, seen, skipped, imported, "analysisQueued",
              "firstGameId", analysed, "updatedAt")
  ON import_runs TO replay_worker;
GRANT USAGE, SELECT ON SEQUENCE import_runs_id_seq TO replay_worker;
GRANT INSERT ON audit_logs TO replay_worker;
GRANT USAGE, SELECT ON SEQUENCE audit_logs_id_seq TO replay_worker;

-- The batch writer (8.8): one INSERT … ON CONFLICT (source, "externalId") DO UPDATE per 100 games.
GRANT INSERT ("referenceId", source, "externalId", "externalUrl", mode, status, rated, "timeClass", "completedAt",
              "expiresAt", "whiteName", "blackName", "whiteRating", "blackRating", "whiteTitle", "blackTitle", outcome,
              "endMethod", result, "winnerId", "ecoCode", "openingName", moves, "moveClocksMs", "plyCount", "startPly",
              "startingFen", fen, "initialTimeSeconds", "incrementSeconds", "creatorTimeRemaining",
              "opponentTimeRemaining", "creatorId", "whitePlayerId", "blackPlayerId", "analysisStatus", "createdAt",
              "updatedAt") ON games TO replay_worker;
GRANT UPDATE ("whitePlayerId", "blackPlayerId") ON games TO replay_worker;
GRANT USAGE, SELECT ON SEQUENCE games_id_seq TO replay_worker;
GRANT INSERT ("gameId", "userId", color, source, mode, "timeClass", rated, "endedAt", result, "ratingBefore",
              "ratingDelta", "opponentName", "opponentRating", "ecoCode", "linkedAccountId", "createdAt", "updatedAt")
  ON game_players TO replay_worker;

-- The purge (8.12).
GRANT EXECUTE ON FUNCTION import_purge_batch(bigint, "GameSource", integer) TO replay_worker;
-- m4s (D2): the purge of the rows removed links marked (the migration grants it too when the role already exists).
SELECT to_regprocedure('public.import_purge_marked_batch(bigint, "GameSource", integer)') IS NOT NULL AS m4s_applied \gset
\if :m4s_applied
GRANT EXECUTE ON FUNCTION import_purge_marked_batch(bigint, "GameSource", integer) TO replay_worker;
REVOKE ALL ON FUNCTION import_purge_marked_batch(bigint, "GameSource", integer) FROM PUBLIC;
\endif

\set QUIET off
SELECT check_name, ok FROM (
  SELECT 'reads the entitlement columns, never email, googleId, dodoCustomerId or subscriptionId' AS check_name,
         has_column_privilege('replay_worker', 'public.users', 'subscriptionStatus', 'SELECT')
         AND has_column_privilege('replay_worker', 'public.users', 'timeZone', 'SELECT')
         AND NOT has_column_privilege('replay_worker', 'public.users', 'email', 'SELECT')
         AND NOT has_column_privilege('replay_worker', 'public.users', 'googleId', 'SELECT')
         AND NOT has_column_privilege('replay_worker', 'public.users', 'dodoCustomerId', 'SELECT')
         AND NOT has_column_privilege('replay_worker', 'public.users', 'subscriptionId', 'SELECT') AS ok
  UNION ALL
  SELECT 'runs an import (accounts, cursors, runs, sequences)',
         has_table_privilege('replay_worker', 'public.linked_accounts', 'SELECT')
         AND has_column_privilege('replay_worker', 'public.linked_accounts', 'importState', 'UPDATE')
         AND has_column_privilege('replay_worker', 'public.linked_accounts', 'importedCount', 'UPDATE')
         AND has_table_privilege('replay_worker', 'public.import_cursors', 'SELECT, INSERT')
         AND has_column_privilege('replay_worker', 'public.import_cursors', 'lichessResumeUntilMs', 'UPDATE')
         AND has_table_privilege('replay_worker', 'public.import_runs', 'SELECT, INSERT')
         AND has_column_privilege('replay_worker', 'public.import_runs', 'status', 'UPDATE')
         AND has_sequence_privilege('replay_worker', 'public.import_runs_id_seq', 'USAGE')
         AND has_sequence_privilege('replay_worker', 'public.games_id_seq', 'USAGE')
  UNION ALL
  SELECT 'never moves a link or a run to another user, or marks a link verified (column UPDATE only)',
         NOT has_table_privilege('replay_worker', 'public.linked_accounts', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.linked_accounts', 'userId', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.linked_accounts', 'verifiedAt', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.linked_accounts', 'provider', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.linked_accounts', 'usernameLower', 'UPDATE')
         AND NOT has_table_privilege('replay_worker', 'public.import_runs', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.import_runs', 'userId', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.import_runs', 'linkedAccountId', 'UPDATE')
         AND NOT has_table_privilege('replay_worker', 'public.import_cursors', 'UPDATE')
         AND NOT has_column_privilege('replay_worker', 'public.import_cursors', 'linkedAccountId', 'UPDATE')
  UNION ALL
  SELECT 'inserts imported games and player rows, never pgn, gameData, meta or openingId',
         has_column_privilege('replay_worker', 'public.games', 'moves', 'INSERT')
         AND has_column_privilege('replay_worker', 'public.game_players', 'linkedAccountId', 'INSERT')
         AND NOT has_column_privilege('replay_worker', 'public.games', 'pgn', 'INSERT')
         AND NOT has_column_privilege('replay_worker', 'public.games', 'gameData', 'INSERT')
         AND NOT has_column_privilege('replay_worker', 'public.games', 'meta', 'INSERT')
         AND NOT has_column_privilege('replay_worker', 'public.games', 'openingId', 'INSERT')
         AND NOT has_column_privilege('replay_worker', 'public.games', 'moves', 'UPDATE')
  UNION ALL
  SELECT 'no DELETE on games, game_players or the import tables; purges only through import_purge_batch()',
         NOT has_table_privilege('replay_worker', 'public.games', 'DELETE')
         AND NOT has_table_privilege('replay_worker', 'public.game_players', 'DELETE')
         AND NOT has_table_privilege('replay_worker', 'public.linked_accounts', 'DELETE')
         AND NOT has_table_privilege('replay_worker', 'public.import_runs', 'DELETE')
         AND has_function_privilege('replay_worker', 'import_purge_batch(bigint, "GameSource", integer)', 'EXECUTE')
  UNION ALL
  SELECT 'nobody else may run import_purge_batch() (EXECUTE revoked from PUBLIC)',
         NOT EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                      WHERE p.proname = 'import_purge_batch' AND a.grantee = 0)
  UNION ALL
  SELECT 'audit_logs: INSERT only', has_table_privilege('replay_worker', 'public.audit_logs', 'INSERT')
         AND NOT has_table_privilege('replay_worker', 'public.audit_logs', 'SELECT')
  UNION ALL
  SELECT 'no access to trial_ledger', NOT has_table_privilege('replay_worker', 'public.trial_ledger', 'SELECT')
) checks;

\else
  \echo 'replay_worker does not exist on this database: nothing changed'
\endif
