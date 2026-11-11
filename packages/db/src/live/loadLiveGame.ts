// Socket session load (phase-02 plan 6.4, 9.2): one statement on the first `game:join` of a game that has no
// in-memory session. A reconnect to an existing session makes no query (socket F-19).
//
// Reads only the columns the `replay_realtime` role may read (sql/roles.sql): the game row, the two players' public
// user columns (ref, name, avatar) and the tournament's ref and name. No email, billing, gameData or pgn.
import { Prisma } from "#generated";
import { parseGameMeta, type GameMetaV1 } from "../json/game-meta";
import type {
  GameEndMethod,
  GameStatus,
  GameWinner,
  LiveGameMode,
  LivePhase,
  Side,
  SqlClient,
  TimeClass,
} from "./types";

export interface LivePlayerRecord {
  userId: bigint;
  /** users.referenceId: the identity the socket token carries (`sub`). */
  ref: string;
  /** Display snapshot from the game row, else the user's current name. */
  name: string;
  rating: number | null;
  title: string | null;
  avatarUrl: string | null;
}

export interface LiveGameRecord {
  id: bigint;
  ref: string;
  status: GameStatus;
  /** null only on legacy rows that the backfill has not reached. */
  mode: LiveGameMode | null;
  rated: boolean;
  timeClass: TimeClass | null;
  startingFen: string;
  startPly: number;
  studySeconds: number;
  initialTimeSeconds: number;
  incrementSeconds: number;
  /** Space-separated UCI from startingFen. */
  moves: string;
  moveClocksMs: number[];
  plyCount: number;
  fen: string | null;
  whiteTimeMs: number | null;
  blackTimeMs: number | null;
  clockRunning: Side | null;
  phase: LivePhase | null;
  phaseEndsAt: Date | null;
  lastMoveAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  endMethod: GameEndMethod | null;
  outcome: GameWinner | null;
  botElo: number | null;
  /** Legacy columns: who created the row and who joined (bot user for legacy bot games). */
  creatorId: bigint;
  opponentId: bigint | null;
  rematchOfId: bigint | null;
  /** The parent game's referenceId (GameState.rematchOf), so a rematch child loaded after a restart keeps it. */
  rematchOfRef: string | null;
  chessPositionId: bigint | null;
  openingId: bigint | null;
  tournament: { id: bigint; ref: string; name: string } | null;
  /** Parsed `games.meta`; null for legacy or malformed values. */
  meta: GameMetaV1 | null;
  /** null = the bot side, or a friend who has not joined yet. */
  white: LivePlayerRecord | null;
  black: LivePlayerRecord | null;
  /** Snapshot names/ratings for a side without a member (bot: "Engine 1400"). */
  whiteName: string | null;
  blackName: string | null;
  whiteRating: number | null;
  blackRating: number | null;
}

interface Row {
  id: bigint;
  ref: string;
  status: GameStatus;
  mode: LiveGameMode | null;
  rated: boolean;
  timeClass: TimeClass | null;
  startingFen: string;
  startPly: number;
  studySeconds: number;
  initialTimeSeconds: number;
  incrementSeconds: number;
  moves: string;
  moveClocksMs: number[] | null;
  plyCount: number;
  fen: string | null;
  whiteTimeMs: number | null;
  blackTimeMs: number | null;
  clockRunning: string | null;
  phase: LivePhase | null;
  phaseEndsAt: Date | null;
  lastMoveAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  endMethod: GameEndMethod | null;
  outcome: GameWinner | null;
  botElo: number | null;
  creatorId: bigint;
  opponentId: bigint | null;
  rematchOfId: bigint | null;
  rematchOfRef: string | null;
  chessPositionId: bigint | null;
  openingId: bigint | null;
  meta: unknown;
  whitePlayerId: bigint | null;
  whiteName: string | null;
  whiteRating: number | null;
  whiteTitle: string | null;
  whiteRef: string | null;
  whiteUserName: string | null;
  whiteAvatar: string | null;
  blackPlayerId: bigint | null;
  blackName: string | null;
  blackRating: number | null;
  blackTitle: string | null;
  blackRef: string | null;
  blackUserName: string | null;
  blackAvatar: string | null;
  tournamentId: bigint | null;
  tournamentRef: string | null;
  tournamentName: string | null;
}

/** The session columns of a game row and its joins; callers add the WHERE. */
const LIVE_GAME_SELECT = Prisma.sql`
    SELECT g.id, g."referenceId" AS ref, g.status::text AS status, g.mode::text AS mode, g.rated,
           g."timeClass"::text AS "timeClass", g."startingFen", g."startPly", g."studySeconds",
           g."initialTimeSeconds", g."incrementSeconds", g.moves, g."moveClocksMs", g."plyCount", g.fen,
           g."whiteTimeMs", g."blackTimeMs", g."clockRunning", g.phase::text AS phase, g."phaseEndsAt",
           g."lastMoveAt", g."startedAt", g."completedAt", g."createdAt", g."expiresAt",
           g."endMethod"::text AS "endMethod", g.outcome::text AS outcome, g."botElo",
           g."creatorId", g."opponentId", g."rematchOfId", g."chessPositionId", g."openingId", g.meta,
           g."whitePlayerId", g."whiteName", g."whiteRating", g."whiteTitle",
           wu."referenceId" AS "whiteRef", wu.name AS "whiteUserName", wu."profilePictureUrl" AS "whiteAvatar",
           g."blackPlayerId", g."blackName", g."blackRating", g."blackTitle",
           bu."referenceId" AS "blackRef", bu.name AS "blackUserName", bu."profilePictureUrl" AS "blackAvatar",
           g."tournamentId", t."referenceId" AS "tournamentRef", t.name AS "tournamentName",
           pg."referenceId" AS "rematchOfRef"
      FROM games g
      LEFT JOIN users wu ON wu.id = g."whitePlayerId"
      LEFT JOIN users bu ON bu.id = g."blackPlayerId"
      LEFT JOIN tournaments t ON t.id = g."tournamentId"
      LEFT JOIN games pg ON pg.id = g."rematchOfId"`;

export function loadLiveGameSql(ref: string): Prisma.Sql {
  return Prisma.sql`${LIVE_GAME_SELECT}
     WHERE g."referenceId" = ${ref}`;
}

function player(
  userId: bigint | null,
  ref: string | null,
  snapshotName: string | null,
  userName: string | null,
  rating: number | null,
  title: string | null,
  avatarUrl: string | null,
): LivePlayerRecord | null {
  if (userId == null || ref == null) return null;
  return { userId, ref, name: snapshotName ?? userName ?? "", rating, title, avatarUrl };
}

/** Loads one game by ref for a socket session (or any server reader). `null` when there is no such game. */
export async function loadLiveGame(db: SqlClient, ref: string): Promise<LiveGameRecord | null> {
  const rows = await db.$queryRaw<Row[]>(loadLiveGameSql(ref));
  const r = rows[0];
  return r ? toRecord(r) : null;
}

/**
 * The socket's boot restore in ONE statement (plan 6.6.8, 7.6): every game that has a journal file (whatever its
 * status: the caller learns which ones already ended) plus every live human game that moved within the window
 * (`restoreList`'s rows), as session records. It replaces the restore list plus one load per candidate, which on the
 * dev box (Mumbai → Neon us-east-1) cost a new pooled connection per parallel load: 5.6–6.9 s for one live game.
 * Served by `games_referenceId_key` and the partial `games_open_idx`.
 */
export function restoreCandidatesSql(journalRefs: readonly string[], windowMs: number): Prisma.Sql {
  return Prisma.sql`${LIVE_GAME_SELECT}
     WHERE g."referenceId" = ANY(${[...journalRefs]}::text[])
        OR (g.status = 'IN_PROGRESS' AND g.mode IN ('FRIEND', 'ONLINE', 'TOURNAMENT')
            AND g."lastMoveAt" > now() - (${windowMs}::int * interval '1 millisecond'))`;
}

export async function loadRestoreCandidates(
  db: SqlClient,
  journalRefs: readonly string[],
  windowMs: number,
): Promise<LiveGameRecord[]> {
  const rows = await db.$queryRaw<Row[]>(restoreCandidatesSql(journalRefs, windowMs));
  return rows.map(toRecord);
}

function toRecord(r: Row): LiveGameRecord {
  return {
    id: r.id,
    ref: r.ref,
    status: r.status,
    mode: r.mode,
    rated: r.rated,
    timeClass: r.timeClass,
    startingFen: r.startingFen,
    startPly: r.startPly,
    studySeconds: r.studySeconds,
    initialTimeSeconds: r.initialTimeSeconds,
    incrementSeconds: r.incrementSeconds,
    moves: r.moves,
    moveClocksMs: r.moveClocksMs ?? [],
    plyCount: r.plyCount,
    fen: r.fen,
    whiteTimeMs: r.whiteTimeMs,
    blackTimeMs: r.blackTimeMs,
    clockRunning: r.clockRunning === "w" || r.clockRunning === "b" ? r.clockRunning : null,
    phase: r.phase,
    phaseEndsAt: r.phaseEndsAt,
    lastMoveAt: r.lastMoveAt,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    endMethod: r.endMethod,
    outcome: r.outcome,
    botElo: r.botElo,
    creatorId: r.creatorId,
    opponentId: r.opponentId,
    rematchOfId: r.rematchOfId,
    rematchOfRef: r.rematchOfRef ?? null,
    chessPositionId: r.chessPositionId,
    openingId: r.openingId,
    tournament:
      r.tournamentId != null && r.tournamentRef != null
        ? { id: r.tournamentId, ref: r.tournamentRef, name: r.tournamentName ?? "" }
        : null,
    meta: parseGameMeta(r.meta),
    white: player(r.whitePlayerId, r.whiteRef, r.whiteName, r.whiteUserName, r.whiteRating, r.whiteTitle, r.whiteAvatar),
    black: player(r.blackPlayerId, r.blackRef, r.blackName, r.blackUserName, r.blackRating, r.blackTitle, r.blackAvatar),
    whiteName: r.whiteName,
    blackName: r.blackName,
    whiteRating: r.whiteRating,
    blackRating: r.blackRating,
  };
}
