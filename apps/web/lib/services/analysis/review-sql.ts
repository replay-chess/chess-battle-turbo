// The review read statements (phase-03 plan §6.4 probe, §9.2 A1, §7.3 getReviewStatus / getLegendCompare). Each
// read is ONE statement by the unique game ref, with P2's column names (R-01) and only primary-key / unique lookups:
// games_referenceId_key → game_players_pkey (the player check) → game_analyses_pkey, player_reviews_pkey,
// jobs_dedupeKey_key, legend_comparisons_pkey, shares_owner_idx (and chess_positions / legends by id).
//
// The player check is the LATERAL `gp` row: the viewer's own game_players row, or (admins only, support reads) the
// White member row, else the Black one. No row → the caller answers 404, so a game's existence is never revealed.
// Opponent review data is never selected: `pr` and `lc` join on the chosen member side only.
//
// Times: Prisma's DateTime columns are timestamp(3) without zone, stored in UTC, so every comparison with the clock
// uses (now() AT TIME ZONE 'UTC') and nothing depends on the session TimeZone.
import { Prisma } from "@repo/db";
import { BANK_CARDS_COLUMN, BANK_TOKEN_COLUMN, NO_BANK_COLUMNS } from "@/lib/train/reviewBank.server";
import { effectiveAnalysisStatusSql } from "./status-sql";

export type ReadKind = "probe" | "status" | "review" | "legend";

export type ReadArgs = {
  viewerId: bigint;
  ref: string;
  /** Admins may read any game (the member row stands in for "you"). */
  admin: boolean;
  /** A9 `?include=explanation`: select the ~20 KB explanation JSON. */
  includeExplanation?: boolean;
  /**
   * P5 (phase-05 §7.3 "Review bank fields", `train` flag): the bank token on every read (both ETags include it) and
   * the moment cards on `review` / `status`, as scalar subqueries of the same statement. Off → P3's columns only.
   */
  bank?: boolean;
};

const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

/** Columns of every read: the ETag parts, the job state (stall rule, kick CAS) and the comparison state. */
const P3_PROBE_COLUMNS = Prisma.sql`
  g.id AS "gameId", g."referenceId" AS ref, ${effectiveAnalysisStatusSql()} AS "analysisStatus", g."chessPositionId",
  gp."userId" AS "memberId", gp.color, gp."isPlayer",
  a.version, a."gradedPlies", a."totalPlies", a."failedAtPly", a."updatedAt" AS "analysisUpdatedAt",
  pr."updatedAt" AS "reviewUpdatedAt",
  j.status::text AS "jobStatus", j.attempts, j."maxAttempts", j."runAt", j."heartbeatAt", j."lastKickAt", j."lastError",
  s.code AS "shareCode", s."showUsername" AS "shareShowUsername", s."expiresAt" AS "shareExpiresAt",
  lc.status::text AS "comparisonStatus", lc."updatedAt" AS "comparisonUpdatedAt"`;

/** P3's probe columns plus the P5 bank token (null with the `train` flag off). */
const probeColumns = (args: ReadArgs) =>
  Prisma.sql`${P3_PROBE_COLUMNS}, gp."bankVersion", ${args.bank ? BANK_TOKEN_COLUMN : NO_BANK_COLUMNS}`;

/** P5: the member side's moment cards (`review`, `status`). */
const bankCards = (args: ReadArgs) => (args.bank ? Prisma.sql`, ${BANK_CARDS_COLUMN}` : Prisma.empty);

/** Jobs ahead of this one in the claim order (priority DESC, fairSeq, runAt), only while it is QUEUED. */
const QUEUE_AHEAD = Prisma.sql`
  CASE WHEN j.status = 'QUEUED' THEN (
    SELECT count(*) FROM jobs q
     WHERE q.status = 'QUEUED' AND q.id <> j.id AND q."runAt" <= ${NOW}
       AND (q.priority > j.priority
            OR (q.priority = j.priority AND (q."fairSeq", q."runAt", q.id) < (j."fairSeq", j."runAt", j.id)))
  )::int END AS "queueAhead"`;

/** The game columns the DTO builders read (moves for SAN, clocks, labels). */
const GAME_COLUMNS = Prisma.sql`
  g.mode::text AS mode, g.source::text AS source, g."startingFen", g."startPly", g.moves, g."moveClocksMs",
  g."plyCount", g.status::text AS "gameStatus", g.outcome::text AS outcome, g."endMethod"::text AS "endMethod",
  g."completedAt", g."timeClass"::text AS "timeClass", g."ecoCode", g."openingName", g."initialTimeSeconds",
  g."incrementSeconds", g."botElo", g.meta->'position' AS "metaPosition",
  COALESCE(g."completedAt", g."updatedAt") AS "playedAt"`;

/** "You" (users.name + gp.ratingBefore) and the opponent snapshot (gp.opponentName/Rating; opp row if a member). */
const PLAYER_COLUMNS = Prisma.sql`
  -- An imported game's own side is the member's provider handle (games.whiteName / blackName), not users.name (D5).
  CASE WHEN g.source <> 'REPLAY'
       THEN COALESCE(NULLIF(CASE gp.color WHEN 'w' THEN g."whiteName" ELSE g."blackName" END, ''), u.name)
       ELSE u.name END AS "youName", gp."ratingBefore", gp."opponentUserId", gp."opponentName", gp."opponentRating",
  gp.accuracy AS "myAccuracy", gp."phaseAccuracy" AS "myPhaseAccuracy", gp."momentsCount",
  opp.accuracy AS "oppAccuracy", opp."phaseAccuracy" AS "oppPhaseAccuracy"`;

/** The legend position as far as the comparison needs it (names per side, the PGN, the result metadata). */
const LEGEND_SOURCE_COLUMNS = Prisma.sql`
  cp."referenceId" AS "positionRef", cp."moveNumber" AS "legendMoveNumber", cp."gameMetadata" AS "legendMeta",
  cp."whitePlayerName", cp."blackPlayerName", wl.name AS "whiteLegendName", bl.name AS "blackLegendName",
  cp."tournamentName", cp."eventDate", (cp.pgn IS NOT NULL) AS "legendHasPgn"`;

const BASE_FROM = (args: ReadArgs) => Prisma.sql`
  FROM games g
  JOIN LATERAL (
    SELECT p."gameId", p."userId", p.color, p."opponentUserId", p."opponentName", p."opponentRating", p."ratingBefore",
           p.accuracy, p."phaseAccuracy", p."momentsCount", p."bankVersion", (p."userId" = ${args.viewerId}) AS "isPlayer"
      FROM game_players p
     WHERE p."gameId" = g.id AND (p."userId" = ${args.viewerId} OR ${args.admin}::boolean)
     ORDER BY (p."userId" = ${args.viewerId}) DESC, p.color DESC
     LIMIT 1) gp ON true
  LEFT JOIN game_analyses a ON a."gameId" = g.id
  -- Both key columns from gp: the planner always gets the (gameId, color) lookup, never a color-only scan (FIX-1).
  LEFT JOIN player_reviews pr ON pr."gameId" = gp."gameId" AND pr.color = gp.color
  LEFT JOIN jobs j ON j."dedupeKey" = 'analyze:' || g.id
  LEFT JOIN legend_comparisons lc ON lc."gameId" = g.id AND lc."userId" = gp."userId"
  LEFT JOIN LATERAL (
    SELECT code, "expiresAt", "showUsername" FROM shares
     WHERE "ownerId" = ${args.viewerId} AND kind = 'REVIEW' AND "gameId" = g.id AND "revokedAt" IS NULL
       AND "expiresAt" > ${NOW}
     ORDER BY "createdAt" DESC LIMIT 1) s ON true`;

const PLAYER_JOINS = Prisma.sql`
  JOIN users u ON u.id = gp."userId"
  LEFT JOIN game_players opp ON opp."gameId" = g.id AND opp.color <> gp.color`;

const LEGEND_JOINS = Prisma.sql`
  LEFT JOIN chess_positions cp ON cp.id = g."chessPositionId"
  LEFT JOIN legends wl ON wl.id = cp."whitePlayerId"
  LEFT JOIN legends bl ON bl.id = cp."blackPlayerId"`;

/**
 * One read statement:
 * - `probe` (A1/A2 ETag, the 304 path): the probe columns only;
 * - `review` (A1, the review RSC): + the game, both player chips, the analysis arrays, the viewer's review, the
 *   queue position and the legend name;
 * - `status` (A2): + the queue position, the review summary, the comparison facts and, only when the facts row is
 *   missing, what the lazy `legend_facts` insert needs (moves and the legend PGN);
 * - `legend` (A9, A9b, the compare RSC): + the game, the players, the facts and the legend position.
 */
export function reviewReadSql(kind: ReadKind, args: ReadArgs): Prisma.Sql {
  const where = Prisma.sql`WHERE g."referenceId" = ${args.ref}`;
  switch (kind) {
    case "probe":
      return Prisma.sql`SELECT ${probeColumns(args)} ${BASE_FROM(args)} ${where}`;
    case "review":
      return Prisma.sql`SELECT ${probeColumns(args)}, ${GAME_COLUMNS}, ${PLAYER_COLUMNS}, ${QUEUE_AHEAD},
        a.engine, a.evals, a.best, a.judgements, a."middlegamePly", a."endgamePly", a."accuracyWhite",
        a."accuracyBlack", a."countsWhite", a."countsBlack", a."depthP50",
        pr.content, pr."textStatus", pr.progress, pr."startedAt" AS "reviewStartedAt",
        pr."completedAt" AS "reviewCompletedAt",
        lc.facts->>'historicalName' AS "legendName", ${LEGEND_SOURCE_COLUMNS} ${bankCards(args)}
        ${BASE_FROM(args)} ${PLAYER_JOINS} ${LEGEND_JOINS} ${where}`;
    case "status":
      return Prisma.sql`SELECT ${probeColumns(args)}, ${QUEUE_AHEAD},
        g."plyCount", g.status::text AS "gameStatus", g.outcome::text AS outcome, g."startingFen", g."startPly",
        gp.accuracy AS "myAccuracy", gp."momentsCount",
        (pr.content->>'isClean')::boolean AS "isClean", pr.content->'coachLine'->>'t' AS "coachLine",
        lc.facts AS "comparisonFacts",
        CASE WHEN lc."gameId" IS NULL THEN g.moves END AS moves,
        CASE WHEN lc."gameId" IS NULL THEN cp.pgn END AS "legendPgn", ${LEGEND_SOURCE_COLUMNS} ${bankCards(args)}
        ${BASE_FROM(args)} ${LEGEND_JOINS} ${where}`;
    case "legend":
      return Prisma.sql`SELECT ${probeColumns(args)}, ${GAME_COLUMNS}, ${PLAYER_COLUMNS},
        lc.facts AS "comparisonFacts", lc.attempts AS "comparisonAttempts",
        cp.pgn AS "legendPgn", cp."explanationAudioUrl", (cp.explanation IS NOT NULL) AS "hasExplanation",
        ${args.includeExplanation ? Prisma.sql`cp.explanation` : Prisma.sql`NULL::jsonb`} AS explanation,
        ${LEGEND_SOURCE_COLUMNS}
        ${BASE_FROM(args)} ${PLAYER_JOINS} ${LEGEND_JOINS} ${where}`;
  }
}

// ── Row shapes (what the driver returns: bigint ids, Date times, number arrays, parsed JSON) ─────────────────────
export type ProbeRow = {
  gameId: bigint;
  ref: string;
  analysisStatus: "NONE" | "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";
  chessPositionId: bigint | null;
  memberId: bigint;
  color: "w" | "b";
  isPlayer: boolean;
  version: number | null;
  gradedPlies: number | null;
  totalPlies: number | null;
  failedAtPly: number | null;
  analysisUpdatedAt: Date | null;
  reviewUpdatedAt: Date | null;
  jobStatus: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED" | null;
  attempts: number | null;
  maxAttempts: number | null;
  runAt: Date | null;
  heartbeatAt: Date | null;
  lastKickAt: Date | null;
  lastError: string | null;
  shareCode: string | null;
  shareShowUsername: boolean | null;
  shareExpiresAt: Date | null;
  comparisonStatus: "FACTS_READY" | "NARRATING" | "READY" | "FAILED" | null;
  comparisonUpdatedAt: Date | null;
  /** P5: the side's Mistake Bank extraction version (0 = not extracted). */
  bankVersion?: number | null;
  /** P5: the bank part of the ETags (`train` flag on), else null. */
  bankToken?: string | null;
  /** P5 (`review`, `status` with the flag on): the moment cards, `[{ply, key, due}]`. */
  bankCards?: unknown;
};

export type GameColumns = {
  mode: "LEGEND_BOT" | "BOT" | "FRIEND" | "ONLINE" | "TOURNAMENT" | "IMPORTED" | null;
  source: "REPLAY" | "CHESSCOM" | "LICHESS";
  startingFen: string;
  startPly: number;
  moves: string;
  moveClocksMs: number[] | null;
  plyCount: number;
  gameStatus: string;
  outcome: "WHITE" | "BLACK" | "DRAW" | "NONE" | null;
  endMethod: string | null;
  completedAt: Date | null;
  /** completedAt, or updatedAt for a game that never completed. */
  playedAt: Date;
  timeClass: "BULLET" | "BLITZ" | "RAPID" | "CLASSICAL" | "DAILY" | "UNTIMED" | null;
  ecoCode: string | null;
  openingName: string | null;
  initialTimeSeconds: number;
  incrementSeconds: number;
  botElo: number | null;
  metaPosition: unknown;
};

export type PlayerColumns = {
  youName: string;
  ratingBefore: number | null;
  opponentUserId: bigint | null;
  opponentName: string;
  opponentRating: number | null;
  myAccuracy: number | null;
  myPhaseAccuracy: number[] | null;
  momentsCount: number;
  oppAccuracy: number | null;
  oppPhaseAccuracy: number[] | null;
};

export type LegendSourceColumns = {
  positionRef: string | null;
  legendMoveNumber: number | null;
  legendMeta: unknown;
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  whiteLegendName: string | null;
  blackLegendName: string | null;
  tournamentName: string | null;
  eventDate: Date | null;
  legendHasPgn: boolean | null;
};

export type ReviewRow = ProbeRow &
  GameColumns &
  PlayerColumns &
  LegendSourceColumns & {
    queueAhead: number | null;
    engine: string | null;
    evals: number[] | null;
    best: number[] | null;
    judgements: number[] | null;
    middlegamePly: number | null;
    endgamePly: number | null;
    accuracyWhite: number | null;
    accuracyBlack: number | null;
    countsWhite: number[] | null;
    countsBlack: number[] | null;
    depthP50: number | null;
    content: unknown;
    textStatus: string | null;
    progress: unknown;
    reviewStartedAt: Date | null;
    reviewCompletedAt: Date | null;
    legendName: string | null;
  };

export type StatusRow = ProbeRow &
  LegendSourceColumns & {
    queueAhead: number | null;
    plyCount: number;
    gameStatus: string;
    outcome: GameColumns["outcome"];
    startingFen: string;
    startPly: number;
    myAccuracy: number | null;
    momentsCount: number;
    isClean: boolean | null;
    coachLine: string | null;
    comparisonFacts: unknown;
    /** Only when the facts row is missing (the lazy insert). */
    moves: string | null;
    legendPgn: string | null;
  };

export type LegendRow = ProbeRow &
  GameColumns &
  PlayerColumns &
  LegendSourceColumns & {
    comparisonFacts: unknown;
    comparisonAttempts: number | null;
    legendPgn: string | null;
    explanationAudioUrl: string | null;
    hasExplanation: boolean;
    explanation: unknown;
  };
