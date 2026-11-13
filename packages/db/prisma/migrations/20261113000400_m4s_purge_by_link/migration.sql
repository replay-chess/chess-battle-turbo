-- m4s (phase-04 stage B, defect D2, data loss): a disconnect with "Also delete the N imported games" purges only the
-- games imported through that link.
--
-- import_purge_batch(user, source) deletes every game_players row of the member and source. Unlink deletes the
-- linked_accounts row, and its FK sets game_players."linkedAccountId" to NULL, so the purge could no longer tell the
-- link's games from any other. On dev: unlink hikaru KEEPING its 2,000 games, link anishgiri (100), disconnect it with
-- the box ticked ("Also delete the 100 imported games"): the purge removed 2,100 games.
--
-- Expand-only:
--   * game_players."purgeLinkId" BIGINT NULL (no FK, no default: no rewrite): the id of the removed link whose purge
--     owns the row. The unlink transaction sets it on the link's rows (and its claim copies' rows) BEFORE it deletes
--     the link, so the set is exact and survives the SET NULL. Rows kept by an earlier unlink, another link of the same
--     provider and other members' sides of a shared game are never marked;
--   * a partial index on ("userId", source) of the marked rows only (empty unless a purge is pending);
--   * import_purge_marked_batch(p_user, p_source, p_limit): import_purge_batch's body (m4q) over the member's MARKED
--     rows of the source only. The purge job keeps its one row per member and provider (`importpurge:<user>:<provider>`,
--     the key the import's pending-purge probe reads through jobs_dedupeKey_key), so two links removed with "delete
--     games" before it runs are purged together, each by its own marks. The old function stays for the ops rollback
--     tool (apps/web/scripts/ops/purge-imports.ts: whole source, links kept) and for purge jobs queued before this
--     release (payload without linkedAccountId).
-- SECURITY DEFINER like import_purge_batch; EXECUTE revoked from PUBLIC and granted to replay_worker when the role
-- exists (packages/db/scripts/roles/replay_worker.p4.sql grants it too, for a database whose roles come later).
-- Apply with `prisma migrate deploy`.

SET lock_timeout = '5s';

ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "purgeLinkId" BIGINT;

CREATE INDEX IF NOT EXISTS "game_players_purge_marked_idx"
  ON "game_players" ("userId", source) WHERE "purgeLinkId" IS NOT NULL;

CREATE OR REPLACE FUNCTION import_purge_marked_batch(p_user bigint, p_source "GameSource", p_limit int DEFAULT 500)
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
    RAISE EXCEPTION 'import_purge_marked_batch: REPLAY games are never purged';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'import_purge_marked_batch: p_limit must be 1..1000';
  END IF;

  -- The member's rows of this source that an unlink marked (game_players_purge_marked_idx).
  WITH victims AS (
    SELECT gp."gameId" FROM game_players gp
     WHERE gp."userId" = p_user AND gp.source = p_source AND gp."purgeLinkId" IS NOT NULL
     LIMIT p_limit
  ), del_gp AS (
    DELETE FROM game_players gp USING victims v
     WHERE gp."gameId" = v."gameId" AND gp."userId" = p_user AND gp."purgeLinkId" IS NOT NULL
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
REVOKE ALL ON FUNCTION import_purge_marked_batch(bigint, "GameSource", int) FROM PUBLIC;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replay_worker') THEN
    GRANT EXECUTE ON FUNCTION import_purge_marked_batch(bigint, "GameSource", int) TO replay_worker;
  END IF;
END
$grant$;
