// Live-game creation and join (phase-02 plan 6.6.2, 7.2). One helper for every writer of a live game:
// `chess/create-game` (friend, creator side only, WAITING_FOR_OPPONENT, phase WAITING), `chess/join` (fills the
// other side), `matchmaking.service.ts` and `tournament/find-match` (both sides, IN_PROGRESS), and from P8/P12 the
// legend-practice and arena creators.
//
// Each function is ONE statement (a data-modifying CTE), so it is atomic on its own, and it runs inside the caller's
// `tx` when one is passed (fixes DB-11, which used the global client inside a transaction). Raw SQL keeps it
// independent of the generated model types; the enums are cast in SQL.
import { Prisma } from "#generated";
import { buildGameMeta, emptyGameMeta, type GameMetaV1Input } from "../json/game-meta";
import type { LiveGameMode, LivePhase, SqlClient } from "../live/types";
import {
  botDisplayName,
  clampRating,
  clipName,
  clipTitle,
  startPlyOf,
  studySecondsFor,
  timeClassOf,
} from "./derive";
import { newGameRef } from "./ref";

export interface LiveSideInput {
  userId: bigint;
  /** Display name snapshot (≤ 40 chars). */
  name: string;
  /** Displayed rating at start (Chess.com-derived in P2), or null. */
  rating?: number | null;
  title?: string | null;
}

export interface CreateLiveGameInput {
  mode: LiveGameMode;
  /** Default: a fresh ref (`newGameRef`). */
  ref?: string;
  /** Legacy `creatorId` (the member who created the row). */
  creatorId: bigint;
  /** Legacy `opponentId`. Default: the other member side, or `bot.userId`. */
  opponentId?: bigint | null;
  /** null = the bot side, or the side a friend will take on join. */
  white: LiveSideInput | null;
  black: LiveSideInput | null;
  /** Bot games: the ladder Elo and the legacy bot user (CHESS_BOT_001). The null side is the bot. */
  bot?: { elo: number; userId?: bigint | null } | null;
  startingFen: string;
  initialTimeSeconds: number;
  incrementSeconds: number;
  /** Untimed bot games: timeClass UNTIMED and no clock columns. */
  untimed?: boolean;
  /** Default: IN_PROGRESS when both sides are filled (or a bot plays one), else WAITING_FOR_OPPONENT. */
  status?: "WAITING_FOR_OPPONENT" | "IN_PROGRESS";
  /** Default: WAITING for human games (the socket moves it on), PLAYING for bot games. */
  phase?: LivePhase;
  /** Default: `studySecondsFor(startingFen)` (owner Q1); bot games pass 0. */
  studySeconds?: number;
  rated?: boolean;
  chessPositionId?: bigint | null;
  openingId?: bigint | null;
  tournamentId?: bigint | null;
  rematchOfId?: bigint | null;
  /** GameMetaV1 input; validated here. Default: empty header and prefix. */
  meta?: GameMetaV1Input | null;
  /** Legacy `gameData` for readers that still use it (game-by-ref invite projection, analysis adapter). */
  gameData?: Record<string, unknown> | null;
  expiresAt: Date;
  now?: Date;
}

export interface CreateLiveGameResult {
  id: bigint;
  ref: string;
  /** game_players rows written (1 for a waiting friend game or a bot game, 2 when both members are set). */
  players: number;
}

interface PlayerRow {
  userId: bigint;
  color: "w" | "b";
  opponentUserId: bigint | null;
  opponentName: string;
  opponentRating: number | null;
  ratingBefore: number | null;
}

/** Resolves every column value. Exported for tests and for callers that log what they write. */
export function resolveLiveGame(input: CreateLiveGameInput) {
  if (input.white && input.black && input.white.userId === input.black.userId) {
    throw new Error("createLiveGame: a member cannot play both sides");
  }
  const isBot = input.mode === "BOT" || input.mode === "LEGEND_BOT";
  if (isBot && !input.bot) throw new Error(`createLiveGame: mode ${input.mode} needs bot.elo`);
  if (isBot && !!input.white === !!input.black) throw new Error("createLiveGame: a bot game has exactly one member side");
  const now = input.now ?? new Date();
  const both = !!input.white && !!input.black;
  const status = input.status ?? (both || isBot ? "IN_PROGRESS" : "WAITING_FOR_OPPONENT");
  const timeClass = timeClassOf(
    input.untimed ? null : { initialSeconds: input.initialTimeSeconds, incrementSeconds: input.incrementSeconds },
  );
  const initialMs = input.untimed ? null : input.initialTimeSeconds * 1000;
  const botName = input.bot ? botDisplayName(input.bot.elo) : null;
  const sideName = (s: LiveSideInput | null) => (s ? clipName(s.name) : isBot ? botName : null);
  const sideRating = (s: LiveSideInput | null) => (s ? clampRating(s.rating) : isBot ? input.bot!.elo : null);
  const meta = input.meta ? buildGameMeta(input.meta) : emptyGameMeta();

  const players: PlayerRow[] = [];
  for (const [color, me, opp] of [
    ["w", input.white, input.black],
    ["b", input.black, input.white],
  ] as const) {
    if (!me) continue;
    players.push({
      userId: me.userId,
      color,
      opponentUserId: opp?.userId ?? null,
      opponentName: (opp ? clipName(opp.name) : isBot ? botName : null) ?? "",
      opponentRating: opp ? clampRating(opp.rating) : isBot ? input.bot!.elo : null,
      ratingBefore: clampRating(me.rating),
    });
  }

  const otherMember = input.white?.userId === input.creatorId ? input.black?.userId : input.white?.userId;
  return {
    ref: input.ref ?? newGameRef(now.getTime()),
    status,
    phase: input.phase ?? (isBot ? "PLAYING" : "WAITING"),
    timeClass,
    studySeconds: input.studySeconds ?? (isBot ? 0 : studySecondsFor(input.startingFen)),
    startPly: startPlyOf(input.startingFen),
    initialMs,
    opponentId: input.opponentId !== undefined ? input.opponentId : (otherMember ?? input.bot?.userId ?? null),
    whiteName: sideName(input.white),
    blackName: sideName(input.black),
    whiteRating: sideRating(input.white),
    blackRating: sideRating(input.black),
    whiteTitle: clipTitle(input.white?.title),
    blackTitle: clipTitle(input.black?.title),
    meta,
    players,
    now,
    inProgress: status === "IN_PROGRESS",
  };
}

export function createLiveGameSql(input: CreateLiveGameInput): { sql: Prisma.Sql; ref: string } {
  const r = resolveLiveGame(input);
  const startedAt = r.inProgress ? r.now : null;
  const gameData = input.gameData ? JSON.stringify(input.gameData) : null;
  const playerValues = r.players.map(
    (p) => Prisma.sql`(${p.userId}::bigint, ${p.color}::char(1), ${p.opponentUserId}::bigint, ${p.opponentName}::varchar(40),
                       ${p.opponentRating}::smallint, ${p.ratingBefore}::smallint)`,
  );
  const gpCte =
    playerValues.length > 0
      ? Prisma.sql`, gp AS (
          INSERT INTO game_players ("gameId", "userId", color, mode, "timeClass", rated, "opponentUserId", "opponentName",
                                    "opponentRating", "ratingBefore", "tournamentId", source, "createdAt", "updatedAt")
          SELECT g.id, v.uid, v.color, g.mode, g."timeClass", g.rated, v.opp, v.opp_name, v.opp_rating, v.rating_before,
                 g."tournamentId", 'REPLAY', ${r.now}::timestamp(3), ${r.now}::timestamp(3)
            FROM g CROSS JOIN (VALUES ${Prisma.join(playerValues, ", ")}) AS v(uid, color, opp, opp_name, opp_rating, rating_before)
          RETURNING 1
        )`
      : Prisma.empty;
  const sql = Prisma.sql`
    WITH g AS (
      INSERT INTO games ("referenceId", "creatorId", "opponentId", status, mode, rated, "timeClass", "botElo",
                         "whitePlayerId", "blackPlayerId", "startingFen", "startPly", "studySeconds", fen,
                         "initialTimeSeconds", "incrementSeconds", "creatorTimeRemaining", "opponentTimeRemaining",
                         "whiteTimeMs", "blackTimeMs", phase, "chessPositionId", "openingId", "tournamentId",
                         "rematchOfId", meta, "gameData", "whiteName", "blackName", "whiteRating", "blackRating",
                         "whiteTitle", "blackTitle", source, "startedAt", "lastMoveAt", "expiresAt", "createdAt", "updatedAt")
      VALUES (${r.ref}, ${input.creatorId}, ${r.opponentId}::bigint, ${r.status}::"GameStatus", ${input.mode}::"GameMode",
              ${input.rated ?? false}, ${r.timeClass}::"TimeClass", ${input.bot?.elo ?? null}::smallint,
              ${input.white?.userId ?? null}::bigint, ${input.black?.userId ?? null}::bigint,
              ${input.startingFen}, ${r.startPly}, ${r.studySeconds}, ${input.startingFen},
              ${input.initialTimeSeconds}, ${input.incrementSeconds}, ${input.initialTimeSeconds}, ${input.initialTimeSeconds},
              ${r.initialMs}::int, ${r.initialMs}::int, ${r.phase}::"LivePhase",
              ${input.chessPositionId ?? null}::bigint, ${input.openingId ?? null}::bigint, ${input.tournamentId ?? null}::bigint,
              ${input.rematchOfId ?? null}::bigint, ${JSON.stringify(r.meta)}::jsonb, ${gameData}::jsonb,
              ${r.whiteName}::varchar(40), ${r.blackName}::varchar(40), ${r.whiteRating}::smallint, ${r.blackRating}::smallint,
              ${r.whiteTitle}::varchar(4), ${r.blackTitle}::varchar(4), 'REPLAY',
              ${startedAt}::timestamp(3), ${startedAt}::timestamp(3), ${input.expiresAt}::timestamp(3),
              ${r.now}::timestamp(3), ${r.now}::timestamp(3))
      RETURNING id, "referenceId", mode, "timeClass", rated, "tournamentId"
    )${gpCte}
    SELECT g.id, g."referenceId" AS ref, ${playerValues.length > 0 ? Prisma.sql`(SELECT count(*) FROM gp)::int` : Prisma.sql`0`} AS players
      FROM g`;
  return { sql, ref: r.ref };
}

/** Inserts the game and its game_players rows in one statement. Pass the caller's `tx` inside a transaction. */
export async function createLiveGame(db: SqlClient, input: CreateLiveGameInput): Promise<CreateLiveGameResult> {
  const { sql } = createLiveGameSql(input);
  const rows = await db.$queryRaw<{ id: bigint; ref: string; players: number }[]>(sql);
  const row = rows[0];
  if (!row) throw new Error("createLiveGame: insert returned no row");
  return row;
}

export interface JoinLiveGameInput {
  ref: string;
  me: LiveSideInput;
  now?: Date;
}

export interface JoinLiveGameResult {
  id: bigint;
  ref: string;
  /** The joiner's colour; null for a legacy row without fixed colours (no game_players row is written then). */
  color: "w" | "b" | null;
}

/**
 * Friend join (plan 6.6.2): conditional on `status = 'WAITING_FOR_OPPONENT' AND "opponentId" IS NULL AND
 * "creatorId" <> me`. Fills the empty colour and its display snapshot, inserts the joiner's game_players row
 * (unique (gameId, color) backs it up) and completes the creator's row. Returns null when the game was not joinable
 * (already started, own game, unknown): the caller re-reads and answers 409 `conflict {reason: already_started}`.
 */
export function joinLiveGameSql(input: JoinLiveGameInput): Prisma.Sql {
  const me = input.me.userId;
  const name = clipName(input.me.name) ?? "";
  const rating = clampRating(input.me.rating);
  const title = clipTitle(input.me.title);
  const now = input.now ?? new Date();
  // SET expressions see the OLD row; a side is filled only when the other one is already fixed (legacy rows with
  // no colours keep both NULL and get no game_players row).
  const takesBlack = Prisma.sql`("whitePlayerId" IS NOT NULL AND "blackPlayerId" IS NULL)`;
  const takesWhite = Prisma.sql`("blackPlayerId" IS NOT NULL AND "whitePlayerId" IS NULL)`;
  return Prisma.sql`
    WITH g AS (
      UPDATE games SET "opponentId" = ${me}, status = 'IN_PROGRESS', "startedAt" = ${now}::timestamp(3),
             "lastMoveAt" = ${now}::timestamp(3), "updatedAt" = ${now}::timestamp(3),
             "blackPlayerId" = CASE WHEN ${takesBlack} THEN ${me} ELSE "blackPlayerId" END,
             "whitePlayerId" = CASE WHEN ${takesWhite} THEN ${me} ELSE "whitePlayerId" END,
             "blackName"   = CASE WHEN ${takesBlack} THEN ${name}::varchar(40) ELSE "blackName" END,
             "whiteName"   = CASE WHEN ${takesWhite} THEN ${name}::varchar(40) ELSE "whiteName" END,
             "blackRating" = CASE WHEN ${takesBlack} THEN ${rating}::smallint ELSE "blackRating" END,
             "whiteRating" = CASE WHEN ${takesWhite} THEN ${rating}::smallint ELSE "whiteRating" END,
             "blackTitle"  = CASE WHEN ${takesBlack} THEN ${title}::varchar(4) ELSE "blackTitle" END,
             "whiteTitle"  = CASE WHEN ${takesWhite} THEN ${title}::varchar(4) ELSE "whiteTitle" END
       WHERE "referenceId" = ${input.ref} AND status = 'WAITING_FOR_OPPONENT' AND "opponentId" IS NULL
         AND "creatorId" <> ${me}
      RETURNING id, "referenceId", "creatorId", mode, "timeClass", rated, "tournamentId",
                CASE WHEN "whitePlayerId" = ${me} THEN 'w' WHEN "blackPlayerId" = ${me} THEN 'b' END AS color,
                CASE WHEN "whitePlayerId" = ${me} THEN "blackName" ELSE "whiteName" END AS opp_name,
                CASE WHEN "whitePlayerId" = ${me} THEN "blackRating" ELSE "whiteRating" END AS opp_rating
    ), ins AS (
      INSERT INTO game_players ("gameId", "userId", color, mode, "timeClass", rated, "opponentUserId", "opponentName",
                                "opponentRating", "ratingBefore", "tournamentId", source, "createdAt", "updatedAt")
      SELECT g.id, ${me}, g.color, COALESCE(g.mode, 'FRIEND'), g."timeClass", g.rated, g."creatorId",
             COALESCE(g.opp_name, ''), g.opp_rating, ${rating}::smallint, g."tournamentId", 'REPLAY',
             ${now}::timestamp(3), ${now}::timestamp(3)
        FROM g WHERE g.color IS NOT NULL
      RETURNING 1
    ), up AS (
      UPDATE game_players p SET "opponentUserId" = ${me}, "opponentName" = ${name}::varchar(40),
             "opponentRating" = ${rating}::smallint, "updatedAt" = ${now}::timestamp(3)
        FROM g WHERE p."gameId" = g.id AND p."userId" = g."creatorId"
      RETURNING 1
    )
    SELECT g.id, g."referenceId" AS ref, g.color FROM g`;
}

export async function joinLiveGame(db: SqlClient, input: JoinLiveGameInput): Promise<JoinLiveGameResult | null> {
  const rows = await db.$queryRaw<{ id: bigint; ref: string; color: "w" | "b" | null }[]>(joinLiveGameSql(input));
  return rows[0] ?? null;
}
