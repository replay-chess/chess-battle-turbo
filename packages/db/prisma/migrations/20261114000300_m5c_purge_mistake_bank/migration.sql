-- m5c (Phase 5, purged games left in the Mistake Bank): an import purge removes the member's Mistake Bank rows of the
-- games it deletes.
--
-- A disconnect with "Also delete the N imported games" (import_purge_marked_batch, m4s) or the ops rollback
-- (import_purge_batch) deleted the member's side of each game; only mistake_occurrences went with a deleted game (FK
-- cascade). A mistake seen only in purged games kept its row (position, solution, `lastGameId` and `lastOpponentName`
-- of a deleted game), its BANK card and that card's attempts, and `theme_mastery."bankCount"` still counted the card:
-- the member asked for those games to be deleted and still drilled their positions and saw the opponents' names. A
-- game another member still holds survives the purge, and with it the purged member's occurrences on it.
--
-- import_purge_bank(p_user, p_games), called by both purge functions for the games of the batch (`ids`):
--   1. deletes the member's occurrences on those games (their side of each is gone; the opponent's are untouched);
--   2. locks the mistakes they belonged to (ordered by id);
--   3. a mistake with no occurrence left goes, with its card, that card's attempts and the card's `bankCount`
--      (theme_mastery, never below 0);
--   4. a mistake still seen in another game keeps its card and attempts: `occurrences` is recounted, and when its
--      last occurrence (`lastGameId`, `lastPly`) was purged, the `last*` fields point at the newest remaining one (the
--      side's `endedAt`, else the game's `completedAt`; the opponent name as the extraction stores it).
-- Batched with the purge: one call per import_purge_batch / import_purge_marked_batch call, over that batch's games.
--
-- Lock order (m4t kept): the purge still takes the victims' game_analyses and games rows first, then deletes the
-- member's game_players rows (cascading to their player_reviews); the bank step runs next and the users bump after it.
-- That is the order of an extraction batch of another game holding the same mistake (J1 / EXTRACT_MISTAKES: review
-- rows, mistakes, occurrences, cards, theme_mastery, then users last) and of W6 / A6 (review rows, the mistake, the
-- card, the theme row), so none of them can wait on the purge while holding what it waits for. Training attempts
-- (W1) lock the profile, the cards, the sessions and the theme rows; the purge never holds a theme row before a card.
--
-- Expand-only, function-only: no table, column or index change. CREATE OR REPLACE keeps the purge functions' EXECUTE
-- grants (replay_worker) and their REVOKE from PUBLIC; the new helper is SECURITY INVOKER and revoked from PUBLIC, so it
-- runs only inside the two SECURITY DEFINER purges (as their owner). The m4s purge-by-link rule is unchanged: the
-- marked function still deletes only the rows an unlink marked. Statements are mirrored in the P5 hot-query gate
-- (apps/web/scripts/explain-hot-queries.ts, `purgeBankQueries`). Apply with `prisma migrate deploy` (never
-- `prisma db push`, never `prisma migrate dev` against Neon).

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION import_purge_bank(p_user bigint, p_games bigint[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  touched bigint[];
  gone bigint[];
BEGIN
  -- 1. The member's occurrences on these games (mistake_occurrences_pkey by gameId, mistakes_pkey).
  WITH occ AS (
    DELETE FROM mistake_occurrences mo
     USING mistakes m
     WHERE mo."gameId" = ANY (p_games) AND m.id = mo."mistakeId" AND m."userId" = p_user
       AND NOT EXISTS (SELECT 1 FROM game_players gp WHERE gp."gameId" = mo."gameId" AND gp."userId" = p_user)
    RETURNING mo."mistakeId"
  )
  SELECT COALESCE(array_agg(DISTINCT occ."mistakeId"), ARRAY[]::bigint[]) INTO touched FROM occ;
  IF cardinality(touched) = 0 THEN
    RETURN;
  END IF;

  -- 2. Their mistakes, in id order (an extraction of another game holding one waits here, or makes the purge wait).
  PERFORM 1 FROM mistakes m WHERE m.id = ANY (touched) ORDER BY m.id FOR UPDATE;

  -- 3. Seen in no other game: the mistake, its card, the card's attempts, the card's bankCount.
  SELECT COALESCE(array_agg(m.id), ARRAY[]::bigint[]) INTO gone
    FROM mistakes m
   WHERE m.id = ANY (touched) AND NOT EXISTS (SELECT 1 FROM mistake_occurrences o WHERE o."mistakeId" = m.id);
  IF cardinality(gone) > 0 THEN
    WITH dc AS (
      DELETE FROM training_cards c WHERE c."mistakeId" = ANY (gone) AND c."userId" = p_user
      RETURNING c.id, c.theme, c.deck
    ), da AS (
      DELETE FROM training_attempts a WHERE a."userId" = p_user AND a."cardId" IN (SELECT dc.id FROM dc)
    ), t AS (
      SELECT dc.theme, count(*)::int AS n FROM dc WHERE dc.deck = 'BANK' GROUP BY dc.theme
    )
    UPDATE theme_mastery tm SET "bankCount" = GREATEST(0, tm."bankCount" - t.n)
      FROM t
     WHERE tm."userId" = p_user AND tm.theme = t.theme;
    DELETE FROM mistakes m WHERE m.id = ANY (gone) AND m."userId" = p_user;
  END IF;

  -- 4. Still seen elsewhere: the occurrence count, and the last occurrence when it was one of these games.
  UPDATE mistakes m
     SET occurrences = (SELECT count(*) FROM mistake_occurrences o WHERE o."mistakeId" = m.id)::smallint,
         "updatedAt" = now()
   WHERE m.id = ANY (touched) AND m."userId" = p_user;
  UPDATE mistakes m
     SET "lastGameId" = l."gameId", "lastPly" = l.ply, "lastPlayedAt" = l."playedAt", "lastOpponentName" = l.opponent,
         "updatedAt" = now()
    FROM mistakes k
    CROSS JOIN LATERAL (
      SELECT o."gameId", o.ply, COALESCE(gp."endedAt", g."completedAt", k."lastPlayedAt") AS "playedAt",
             left(COALESCE(NULLIF(btrim(gp."opponentName"), ''), 'Opponent'), 40) AS opponent
        FROM mistake_occurrences o
        JOIN games g ON g.id = o."gameId"
        LEFT JOIN game_players gp ON gp."gameId" = o."gameId" AND gp."userId" = k."userId"
       WHERE o."mistakeId" = k.id
       ORDER BY 3 DESC, o."gameId" DESC, o.ply DESC
       LIMIT 1
    ) l
   WHERE m.id = k.id AND k.id = ANY (touched) AND k."userId" = p_user
     AND NOT EXISTS (SELECT 1 FROM mistake_occurrences o
                      WHERE o."gameId" = k."lastGameId" AND o.ply = k."lastPly" AND o."mistakeId" = k.id);
END
$fn$;

REVOKE ALL ON FUNCTION import_purge_bank(bigint, bigint[]) FROM PUBLIC;

-- The two purges (m4t's bodies), each calling import_purge_bank for its batch before the users bump.
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

  -- m5c: the member's Mistake Bank rows of these games, after their side of each game (and its review) and before
  -- the users row: the lock order of an extraction batch and of W6 (reviews, then mistakes, cards, theme rows).
  PERFORM import_purge_bank(p_user, ids);

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

  -- m5c: the member's Mistake Bank rows of these games, after their side of each game (and its review) and before
  -- the users row: the lock order of an extraction batch and of W6 (reviews, then mistakes, cards, theme rows).
  PERFORM import_purge_bank(p_user, ids);

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
