-- m4q (phase-04 FIX-2, import review round 2): import_purge_batch() resets what a purge leaves stale.
--
-- 1. The link's import state. The ops data rollback (apps/web/scripts/ops/purge-imports.ts, plan §14.4) purges with
--    the links kept, but m4p left import_cursors (Chess.com months done:true + their validators, the Lichess
--    since/resume points) and linked_accounts."importedCount" / "skippedCount" as they were: a later sync over the same
--    link re-imported nothing (every month done or 304, Lichess reading only after the old newest game) and Settings
--    kept showing the old count. Once the batch has removed the member's last row of the source, the cursor of each of
--    the member's links of that provider is reset (as a new link's) and the counters go back to 0, so the next sync
--    re-reads the whole window. A purge after an unlink finds no link: nothing to reset.
-- 2. The purged member's identity on a game that SURVIVES (the opponent imported it too). m4p cleared only the player
--    id: the row kept creatorId / winnerId / the legacy result of the purged member, so the legacy participant checks
--    (e.g. /api/analysis/[gameId]: caller.id = creatorId) still admitted them. A survivor the purged member created is
--    handed to the remaining player: creatorId = that player, the legacy result and the two legacy clocks seen from
--    their side (the other colour, so CREATOR_* <-> OPPONENT_* and the clocks swap), winnerId = that player when their
--    colour won, else NULL. A survivor another player created keeps its creator; a winnerId of the purged member is
--    cleared.
-- Everything else as m4p. Function-only: no table, column or index change. CREATE OR REPLACE keeps the EXECUTE grant to
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
REVOKE ALL ON FUNCTION import_purge_batch(bigint, "GameSource", int) FROM PUBLIC;
