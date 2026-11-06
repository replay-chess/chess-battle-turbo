-- EXPLAIN plans of the P2 hot queries (phase-02 plan 9.2, WP-A acceptance: "EXPLAIN plans of §9.2 attached to the
-- PR"; each must stay < 5 ms server time and never Seq Scan games or Sort game_players).
--
-- READ-ONLY: the reads run with EXPLAIN (ANALYZE, BUFFERS); the writes (checkpoint, finish) are planned with plain
-- EXPLAIN, which does not execute them. Safe on the Neon dev branch after the backfill:
--
--   psql "$DEV_DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/db/sql/explain-p2.sql
--
-- It picks a real game, user and open game from the data itself. Never needed on production in P2.

\set ON_ERROR_STOP on
SELECT "referenceId" AS ref, id AS gid FROM games WHERE mode IS NOT NULL ORDER BY id DESC LIMIT 1 \gset
SELECT "userId" AS uid FROM game_players ORDER BY "gameId" DESC LIMIT 1 \gset

\echo '== 1. Session load / snapshot by ref (loadLiveGame; getGameSnapshot reads the same row + users + chess_com_profiles)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT g.id, g."referenceId", g.status, g.moves, g."moveClocksMs", g.meta, wu."referenceId", wu.name, bu."referenceId", bu.name,
       wc."blitzRating", bc."blitzRating", t."referenceId"
  FROM games g
  LEFT JOIN users wu ON wu.id = g."whitePlayerId"
  LEFT JOIN users bu ON bu.id = g."blackPlayerId"
  LEFT JOIN chess_com_profiles wc ON wc."userId" = g."whitePlayerId"
  LEFT JOIN chess_com_profiles bc ON bc."userId" = g."blackPlayerId"
  LEFT JOIN tournaments t ON t.id = g."tournamentId"
 WHERE g."referenceId" = :'ref';

\echo '== 2. Socket boot restore list (games_open_idx)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT "referenceId" FROM games
 WHERE status = 'IN_PROGRESS' AND mode IN ('FRIEND', 'ONLINE', 'TOURNAMENT') AND "lastMoveAt" > now() - interval '2 hours';

\echo '== 3. Stale sweep candidates (games_open_idx)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, "referenceId", "plyCount", fen FROM games
 WHERE status = 'IN_PROGRESS' AND mode IN ('FRIEND', 'ONLINE', 'TOURNAMENT')
   AND "lastMoveAt" < now() - interval '30 minutes' AND ("plyCount" < 2 OR "lastMoveAt" < now() - interval '2 hours')
   AND NOT ("referenceId" = ANY(ARRAY['none']::text[]))
 LIMIT 50;

\echo '== 4. My live games (game_players_userId_endedAt_gameId_idx prefix scan)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT "gameId" FROM game_players WHERE "userId" = :uid AND "endedAt" IS NULL;

\echo '== 5. Archive keyset page (P3 shape; no Sort over game_players)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT "gameId", "endedAt" FROM game_players
 WHERE "userId" = :uid AND ("endedAt", "gameId") < (now(), 9223372036854775807)
 ORDER BY "endedAt" DESC, "gameId" DESC LIMIT 31;

\echo '== 6. Participant check (game_players_pkey)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT 1 FROM game_players WHERE "gameId" = :gid AND "userId" = :uid;

\echo '== 7. Checkpoint (PK, plan only: not executed)'
EXPLAIN (COSTS OFF)
UPDATE games SET moves = 'e2e4', "moveClocksMs" = ARRAY[1]::int[], "plyCount" = 1, fen = 'x', "whiteTimeMs" = 1, "blackTimeMs" = 1,
       "clockRunning" = 'b', phase = 'PLAYING', "phaseEndsAt" = NULL, "lastMoveAt" = now(), "updatedAt" = now()
 WHERE id = :gid AND status = 'IN_PROGRESS' AND "plyCount" <= 1 RETURNING "plyCount";

\echo '== 8. Finish CTE core (PK + game_players join, plan only: not executed)'
EXPLAIN (COSTS OFF)
WITH g AS (
  UPDATE games SET status = 'COMPLETED', phase = 'ENDED' WHERE id = :gid AND status = 'IN_PROGRESS' RETURNING id, "tournamentId"
), gp AS (
  UPDATE game_players p SET result = 'WIN', "endedAt" = now() FROM g WHERE p."gameId" = g.id RETURNING p."userId", p.result
), us AS (
  UPDATE user_stats s SET "totalGamesPlayed" = s."totalGamesPlayed" + 1 FROM gp WHERE s."userId" = gp."userId" RETURNING s."userId"
), uv AS (
  UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1 FROM gp WHERE u.id = gp."userId" RETURNING u.id
)
SELECT (SELECT count(*) FROM g) AS finished;
