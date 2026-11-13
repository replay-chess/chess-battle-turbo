-- m4t (phase-04 stage B, e2e-smoke deadlock): the import purges lock in the analysis final batch's order.
--
-- A purge batch deleted the member's game_players rows first, then bumped users, then deleted / updated the games
-- (cascading to game_analyses and player_reviews). The worker's final analysis batch of one of those games locks the
-- other way round: game_analyses (the final row), games (DONE), game_players (the player_reviews FK, the analysis
-- columns), users (gamesVersion). With both on the same game, each waited for the other (seen locally, 4 times in one
-- stress run of connected.spec + happy-path.spec: "Process A: import_purge_batch … while deleting tuple in
-- game_analyses / Process B: UPDATE games SET "analysisStatus" = 'DONE'", and INSERT INTO player_reviews / UPDATE
-- users against import_purge_batch). Both functions now pick their victims first and lock those games'
-- game_analyses and games rows (ordered by id) before touching any game_players or users row, so a purge either waits
-- for a running final batch to commit or makes it wait; the rest of each body is unchanged (m4q, m4s).
--
-- Function-only, expand-only: no table, column or index change; CREATE OR REPLACE keeps the EXECUTE grants to
-- replay_worker and the REVOKE from PUBLIC. Apply with `prisma migrate deploy`.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION import_purge_batch(p_user bigint, p_source "GameSource", p_limit int DEFAULT 500)
RETURNS TABLE (deleted_players int, deleted_games int, cleared_games int, game_ids bigint[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  ids bigint[];
  victims bigint[];
BEGIN
  IF p_source = 'REPLAY' THEN
    RAISE EXCEPTION 'import_purge_batch: REPLAY games are never purged';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'import_purge_batch: p_limit must be 1..1000';
  END IF;

  -- The member's side of up to p_limit games of this source.
  SELECT COALESCE(array_agg(v."gameId"), ARRAY[]::bigint[]) INTO victims
    FROM (SELECT gp."gameId" FROM game_players gp WHERE gp."userId" = p_user AND gp.source = p_source LIMIT p_limit) v;
  -- m4t: the analysis final batch's lock order (game_analyses, games, then game_players and users) before any row.
  PERFORM 1 FROM game_analyses a WHERE a."gameId" = ANY (victims) ORDER BY a."gameId" FOR UPDATE;
  PERFORM 1 FROM games g WHERE g.id = ANY (victims) ORDER BY g.id FOR UPDATE;
  WITH del_gp AS (
    DELETE FROM game_players gp
     WHERE gp."gameId" = ANY (victims) AND gp."userId" = p_user AND gp.source = p_source
    RETURNING gp."gameId"
  )
  SELECT COALESCE(array_agg(DISTINCT d."gameId"), ARRAY[]::bigint[]) INTO ids FROM del_gp d;
  deleted_players := cardinality(ids);
  game_ids := ids;
  IF deleted_players = 0 THEN
    deleted_games := 0;
    cleared_games := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1 WHERE u.id = p_user;

  -- Analysis jobs: a game with no player left loses its QUEUED job (the game goes below); a survivor keeps it, owned
  -- by a remaining player. A RUNNING job is left alone (the worker's final batch handles a vanished game: DONE
  -- `game_gone`).
  DELETE FROM jobs j
   WHERE j.kind = 'ANALYZE_GAME' AND j.status = 'QUEUED' AND j."gameId" = ANY (ids)
     AND NOT EXISTS (SELECT 1 FROM game_players p WHERE p."gameId" = j."gameId");
  UPDATE jobs j
     SET "userId" = (SELECT min(p."userId") FROM game_players p WHERE p."gameId" = j."gameId")
   WHERE j.kind = 'ANALYZE_GAME' AND j.status = 'QUEUED' AND j."gameId" = ANY (ids) AND j."userId" = p_user
     AND EXISTS (SELECT 1 FROM game_players p WHERE p."gameId" = j."gameId");

  -- The member's own rows on a survivor (a deleted game takes them with it through the FK cascade).
  DELETE FROM shares s WHERE s."ownerId" = p_user AND s."gameId" = ANY (ids);
  DELETE FROM legend_comparisons lc WHERE lc."userId" = p_user AND lc."gameId" = ANY (ids);

  DELETE FROM games g
   WHERE g.id = ANY (ids) AND g.source <> 'REPLAY'
     AND NOT EXISTS (SELECT 1 FROM game_players p WHERE p."gameId" = g.id);
  GET DIAGNOSTICS deleted_games = ROW_COUNT;
  UPDATE games g
     SET "whitePlayerId" = CASE WHEN g."whitePlayerId" = p_user THEN NULL ELSE g."whitePlayerId" END,
         "blackPlayerId" = CASE WHEN g."blackPlayerId" = p_user THEN NULL ELSE g."blackPlayerId" END,
         "updatedAt" = now()
   WHERE g.id = ANY (ids) AND (g."whitePlayerId" = p_user OR g."blackPlayerId" = p_user);
  GET DIAGNOSTICS cleared_games = ROW_COUNT;

  -- 2. Survivors the purged member created: the remaining player takes the legacy creator side (FIX-2).
  UPDATE games g
     SET "creatorId" = h."userId",
         "winnerId" = CASE WHEN (g.outcome = 'WHITE' AND h.color = 'w') OR (g.outcome = 'BLACK' AND h.color = 'b')
                           THEN h."userId" END,
         result = CASE g.result
                    WHEN 'CREATOR_WON' THEN 'OPPONENT_WON'::"GameResult"
                    WHEN 'OPPONENT_WON' THEN 'CREATOR_WON'::"GameResult"
                    WHEN 'CREATOR_TIMEOUT' THEN 'OPPONENT_TIMEOUT'::"GameResult"
                    WHEN 'OPPONENT_TIMEOUT' THEN 'CREATOR_TIMEOUT'::"GameResult"
                    ELSE g.result END,
         "creatorTimeRemaining" = g."opponentTimeRemaining",
         "opponentTimeRemaining" = g."creatorTimeRemaining",
         "updatedAt" = now()
    FROM (SELECT DISTINCT ON (p."gameId") p."gameId", p."userId", p.color
            FROM game_players p WHERE p."gameId" = ANY (ids) ORDER BY p."gameId", p."userId") h
   WHERE h."gameId" = g.id AND g.source <> 'REPLAY' AND g."creatorId" = p_user;
  UPDATE games g SET "winnerId" = NULL, "updatedAt" = now()
   WHERE g.id = ANY (ids) AND g."winnerId" = p_user;

  -- 1. The member's last row of this source is gone: their links of that provider start over (FIX-2).
  IF NOT EXISTS (SELECT 1 FROM game_players p WHERE p."userId" = p_user AND p.source = p_source) THEN
    UPDATE import_cursors c
       SET "archivesEtag" = NULL, "archivesLastModified" = NULL, archives = NULL, "lichessSinceMs" = NULL,
           "lichessResumeUntilMs" = NULL, "oldestImportedAt" = NULL, seen = 0, "skippedVariants" = 0, "updatedAt" = now()
      FROM linked_accounts la
     WHERE c."linkedAccountId" = la.id AND la."userId" = p_user AND la.provider::text = p_source::text;
    UPDATE linked_accounts la
       SET "importedCount" = 0, "skippedCount" = 0, "updatedAt" = now()
     WHERE la."userId" = p_user AND la.provider::text = p_source::text;
  END IF;
  RETURN NEXT;
END
$fn$;

CREATE OR REPLACE FUNCTION import_purge_marked_batch(p_user bigint, p_source "GameSource", p_limit int DEFAULT 500)
RETURNS TABLE (deleted_players int, deleted_games int, cleared_games int, game_ids bigint[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  ids bigint[];
  victims bigint[];
BEGIN
  IF p_source = 'REPLAY' THEN
    RAISE EXCEPTION 'import_purge_marked_batch: REPLAY games are never purged';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'import_purge_marked_batch: p_limit must be 1..1000';
  END IF;

  -- The member's rows of this source that an unlink marked (game_players_purge_marked_idx).
  SELECT COALESCE(array_agg(v."gameId"), ARRAY[]::bigint[]) INTO victims
    FROM (SELECT gp."gameId" FROM game_players gp
           WHERE gp."userId" = p_user AND gp.source = p_source AND gp."purgeLinkId" IS NOT NULL
           LIMIT p_limit) v;
  -- m4t: the analysis final batch's lock order (game_analyses, games, then game_players and users) before any row.
  PERFORM 1 FROM game_analyses a WHERE a."gameId" = ANY (victims) ORDER BY a."gameId" FOR UPDATE;
  PERFORM 1 FROM games g WHERE g.id = ANY (victims) ORDER BY g.id FOR UPDATE;
  WITH del_gp AS (
    DELETE FROM game_players gp
     WHERE gp."gameId" = ANY (victims) AND gp."userId" = p_user AND gp."purgeLinkId" IS NOT NULL
    RETURNING gp."gameId"
  )
  SELECT COALESCE(array_agg(DISTINCT d."gameId"), ARRAY[]::bigint[]) INTO ids FROM del_gp d;
  deleted_players := cardinality(ids);
  game_ids := ids;
  IF deleted_players = 0 THEN
    deleted_games := 0;
    cleared_games := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1 WHERE u.id = p_user;

  -- As import_purge_batch (m4p, m4q) from here on.
  DELETE FROM jobs j
   WHERE j.kind = 'ANALYZE_GAME' AND j.status = 'QUEUED' AND j."gameId" = ANY (ids)
     AND NOT EXISTS (SELECT 1 FROM game_players p WHERE p."gameId" = j."gameId");
  UPDATE jobs j
     SET "userId" = (SELECT min(p."userId") FROM game_players p WHERE p."gameId" = j."gameId")
   WHERE j.kind = 'ANALYZE_GAME' AND j.status = 'QUEUED' AND j."gameId" = ANY (ids) AND j."userId" = p_user
     AND EXISTS (SELECT 1 FROM game_players p WHERE p."gameId" = j."gameId");

  DELETE FROM shares s WHERE s."ownerId" = p_user AND s."gameId" = ANY (ids);
  DELETE FROM legend_comparisons lc WHERE lc."userId" = p_user AND lc."gameId" = ANY (ids);

  DELETE FROM games g
   WHERE g.id = ANY (ids) AND g.source <> 'REPLAY'
     AND NOT EXISTS (SELECT 1 FROM game_players p WHERE p."gameId" = g.id);
  GET DIAGNOSTICS deleted_games = ROW_COUNT;
  UPDATE games g
     SET "whitePlayerId" = CASE WHEN g."whitePlayerId" = p_user THEN NULL ELSE g."whitePlayerId" END,
         "blackPlayerId" = CASE WHEN g."blackPlayerId" = p_user THEN NULL ELSE g."blackPlayerId" END,
         "updatedAt" = now()
   WHERE g.id = ANY (ids) AND (g."whitePlayerId" = p_user OR g."blackPlayerId" = p_user)
     -- a game the member still holds through another row (another link's side of it) keeps their id
     AND NOT EXISTS (SELECT 1 FROM game_players p WHERE p."gameId" = g.id AND p."userId" = p_user);
  GET DIAGNOSTICS cleared_games = ROW_COUNT;

  UPDATE games g
     SET "creatorId" = h."userId",
         "winnerId" = CASE WHEN (g.outcome = 'WHITE' AND h.color = 'w') OR (g.outcome = 'BLACK' AND h.color = 'b')
                           THEN h."userId" END,
         result = CASE g.result
                    WHEN 'CREATOR_WON' THEN 'OPPONENT_WON'::"GameResult"
                    WHEN 'OPPONENT_WON' THEN 'CREATOR_WON'::"GameResult"
                    WHEN 'CREATOR_TIMEOUT' THEN 'OPPONENT_TIMEOUT'::"GameResult"
                    WHEN 'OPPONENT_TIMEOUT' THEN 'CREATOR_TIMEOUT'::"GameResult"
                    ELSE g.result END,
         "creatorTimeRemaining" = g."opponentTimeRemaining",
         "opponentTimeRemaining" = g."creatorTimeRemaining",
         "updatedAt" = now()
    FROM (SELECT DISTINCT ON (p."gameId") p."gameId", p."userId", p.color
            FROM game_players p WHERE p."gameId" = ANY (ids) ORDER BY p."gameId", p."userId") h
   WHERE h."gameId" = g.id AND g.source <> 'REPLAY' AND g."creatorId" = p_user AND h."userId" <> p_user;
  UPDATE games g SET "winnerId" = NULL, "updatedAt" = now()
   WHERE g.id = ANY (ids) AND g."winnerId" = p_user
     AND NOT EXISTS (SELECT 1 FROM game_players p WHERE p."gameId" = g.id AND p."userId" = p_user);
  RETURN NEXT;
END
$fn$;
