// Rematch (phase-02 plan 6.6.6, 8.8): one statement that copies the finished parent with the colours swapped.
// Same time control, start position, mode, `rated` and studySeconds (same start FEN, so the same rule); the new game
// is IN_PROGRESS in phase WAITING until both players attach. The socket checks both players' `ent` from their newest
// tokens before calling (§11).
//
// Idempotent: a parent has at most one rematch child (NOT EXISTS on the partial games_rematch_of_idx), so a retry
// after a lost response returns the existing child with `created: false` instead of a second game.
// Reads named columns only: the socket role (sql/roles.sql) cannot read games."gameData".
import { Prisma } from "#generated";
import { newGameRef } from "../games/ref";
import type { SqlClient } from "./types";

export interface CreateRematchInput {
  parentId: bigint;
  /** users.id of the player who offered (legacy creatorId) and of the one who accepted (legacy opponentId). */
  offererId: bigint;
  accepterId: bigint;
  /** Defaults to a fresh ref. */
  newRef?: string;
  /** Legacy expiry. Default: 24 h. */
  expiresInMs?: number;
}

export interface CreateRematchResult {
  id: bigint;
  ref: string;
  whitePlayerId: bigint | null;
  blackPlayerId: bigint | null;
  /** false: the parent already had a rematch; this is that game. */
  created: boolean;
}

export function createRematchSql(input: CreateRematchInput & { newRef: string }): Prisma.Sql {
  const expiresMs = input.expiresInMs ?? 24 * 60 * 60 * 1000;
  return Prisma.sql`
    WITH parent AS (
      SELECT p.id, p.mode, p.rated, p."timeClass", p."whitePlayerId", p."blackPlayerId", p."startingFen", p."startPly",
             p."studySeconds", p."initialTimeSeconds", p."incrementSeconds", p."chessPositionId", p."openingId", p.meta,
             p."whiteName", p."blackName", p."whiteRating", p."blackRating", p."whiteTitle", p."blackTitle"
        FROM games p
       WHERE p.id = ${input.parentId} AND p.status = 'COMPLETED' AND p.mode IN ('FRIEND', 'ONLINE')
         AND NOT EXISTS (SELECT 1 FROM games c WHERE c."rematchOfId" = p.id)
    ), ng AS (
      INSERT INTO games ("referenceId", "creatorId", "opponentId", status, mode, rated, "timeClass",
                         "whitePlayerId", "blackPlayerId", "startingFen", "startPly", "studySeconds", fen,
                         "initialTimeSeconds", "incrementSeconds", "creatorTimeRemaining", "opponentTimeRemaining",
                         "whiteTimeMs", "blackTimeMs", phase, "chessPositionId", "openingId", "rematchOfId", meta,
                         "whiteName", "blackName", "whiteRating", "blackRating", "whiteTitle", "blackTitle", source,
                         "startedAt", "lastMoveAt", "expiresAt", "createdAt", "updatedAt")
      SELECT ${input.newRef}, ${input.offererId}, ${input.accepterId}, 'IN_PROGRESS', p.mode, p.rated, p."timeClass",
             p."blackPlayerId", p."whitePlayerId",
             p."startingFen", p."startPly", p."studySeconds", p."startingFen",
             p."initialTimeSeconds", p."incrementSeconds", p."initialTimeSeconds", p."initialTimeSeconds",
             p."initialTimeSeconds" * 1000, p."initialTimeSeconds" * 1000, 'WAITING', p."chessPositionId", p."openingId", p.id,
             (jsonb_set(COALESCE(p.meta, '{}'::jsonb), '{assists}', '{"hints":0,"undos":0}'::jsonb)
                || '{"rev":0,"drawOffers":{"w":0,"b":0},"premoves":{"w":0,"b":0}}'::jsonb) - 'abortedBy',
             p."blackName", p."whiteName", p."blackRating", p."whiteRating", p."blackTitle", p."whiteTitle", 'REPLAY',
             now(), now(), now() + (${expiresMs}::int * interval '1 millisecond'), now(), now()
        FROM parent p
      RETURNING id, "referenceId", mode, "timeClass", rated, "whitePlayerId", "blackPlayerId",
                "whiteName", "blackName", "whiteRating", "blackRating"
    ), gp AS (
      INSERT INTO game_players ("gameId", "userId", color, mode, "timeClass", rated, "opponentUserId", "opponentName",
                                "opponentRating", "ratingBefore", source, "createdAt", "updatedAt")
      SELECT ng.id, x.uid, x.color, ng.mode, ng."timeClass", ng.rated, x.opp, COALESCE(x.opp_name, ''), x.opp_rating,
             x.my_rating, 'REPLAY', now(), now()
        FROM ng CROSS JOIN LATERAL (VALUES
               (ng."whitePlayerId", 'w', ng."blackPlayerId", ng."blackName", ng."blackRating", ng."whiteRating"),
               (ng."blackPlayerId", 'b', ng."whitePlayerId", ng."whiteName", ng."whiteRating", ng."blackRating"))
             AS x(uid, color, opp, opp_name, opp_rating, my_rating)
       WHERE x.uid IS NOT NULL
      RETURNING "gameId"
    )
    SELECT ng.id, ng."referenceId" AS ref, ng."whitePlayerId", ng."blackPlayerId", (SELECT count(*) FROM gp)::int AS players
      FROM ng`;
}

export async function createRematch(db: SqlClient, input: CreateRematchInput): Promise<CreateRematchResult | null> {
  const newRef = input.newRef ?? newGameRef();
  const rows = await db.$queryRaw<
    { id: bigint; ref: string; whitePlayerId: bigint | null; blackPlayerId: bigint | null }[]
  >(createRematchSql({ ...input, newRef }));
  const created = rows[0];
  if (created) return { ...created, created: true };
  // Not eligible, or already rematched: return the existing child if there is one.
  const existing = await db.$queryRaw<
    { id: bigint; ref: string; whitePlayerId: bigint | null; blackPlayerId: bigint | null }[]
  >(Prisma.sql`
    SELECT id, "referenceId" AS ref, "whitePlayerId", "blackPlayerId" FROM games
     WHERE "rematchOfId" = ${input.parentId} ORDER BY id LIMIT 1`);
  return existing[0] ? { ...existing[0], created: false } : null;
}
