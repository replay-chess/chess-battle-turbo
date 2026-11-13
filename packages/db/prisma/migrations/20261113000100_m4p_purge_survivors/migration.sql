-- m4p (phase-04 FIX-1): import_purge_batch() for games that SURVIVE the purge (the opponent imported them too).
--
-- M4's body deleted every QUEUED ANALYZE_GAME job of every purged side, including games another member still holds:
-- the survivor kept analysisStatus = QUEUED with no job, so the other member's review and archive showed "queued"
-- forever (releaseImportBacklog only picks NONE games). It also left the purged member's own rows on a survivor: a
-- live share link (shares.ownerId) and their legend comparison. This replacement, same signature and privileges:
--   * deletes the QUEUED analysis job only of a game that is itself deleted (no player left);
--   * hands a survivor's QUEUED analysis job to a remaining player (the job's userId drives fairness and budgets);
--   * deletes the purged member's shares and legend comparisons of the survivors;
--   * otherwise unchanged (game_players of the member and source, gamesVersion bump, games with no player left,
--     whitePlayerId / blackPlayerId cleared on survivors). Still never touches REPLAY games.
-- Function-only: no table, column or index change. CREATE OR REPLACE keeps the EXECUTE grant to replay_worker
-- (packages/db/scripts/roles/replay_worker.p4.sql) and the REVOKE from PUBLIC. Apply with `prisma migrate deploy`.

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
BEGIN
  IF p_source = 'REPLAY' THEN
    RAISE EXCEPTION 'import_purge_batch: REPLAY games are never purged';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'import_purge_batch: p_limit must be 1..1000';
  END IF;

  -- The member's side of up to p_limit games of this source.
  WITH victims AS (
    SELECT gp."gameId" FROM game_players gp WHERE gp."userId" = p_user AND gp.source = p_source LIMIT p_limit
  ), del_gp AS (
    DELETE FROM game_players gp USING victims v
     WHERE gp."gameId" = v."gameId" AND gp."userId" = p_user AND gp.source = p_source
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
  RETURN NEXT;
END
$fn$;
REVOKE ALL ON FUNCTION import_purge_batch(bigint, "GameSource", int) FROM PUBLIC;
