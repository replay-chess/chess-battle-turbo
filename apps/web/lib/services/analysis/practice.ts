// Practice from a position (phase-03 plan §4.8, §5.9, §7.2 PR1, §7.3 getPracticeContext, §11.2 rule 6). The `/practice`
// RSC (through WEB/lib/data/practice.ts) and `GET /api/practice/context` call the same function. Read only: nothing
// is written, nothing is enqueued; the browser engine plays.
//
// Sources (exactly one, PracticeQuery):
// - `?game=<ref>&ply=<n>`: one of the viewer's FINISHED games (404 otherwise, so a live game can never be fed to an
//   engine mid-play; admins read), the position before ply n
//   (an offset from the game's startPly, the same index as MomentDTO.ply and the legend divergence), n in
//   [0, plyCount); without `ply` the game's start position. The user plays their own colour of that game.
// - `?position=<ref>`: a `chess_positions` row by ref; the user plays the side to move.
// - `?fen=`: validated before anything reaches an engine: chess.js's FEN rules, exactly one king each, no pawn on the
//   first or last rank, and the side not to move is not in check. Else 400 `validation_failed`
//   (`details.reason: "illegal_position"`).
import { moveLabel } from "@repo/chess-analysis/codec";
import { legendComparePath } from "@repo/contracts/http/legend";
import { PRACTICE_BOT_ELO, type PracticeContextDTO, type PracticeTarget } from "@repo/contracts/http/practice";
import { reviewPath } from "@repo/contracts/http/review";
import { Prisma } from "@repo/db";
import { parseComparisonFacts } from "@repo/db/json";
import { Chess, validateFen } from "chess.js";
import { ApiError } from "@/lib/api/api-error";
import type { Viewer } from "@/lib/auth/viewer";
import { DataError } from "@/lib/data/errors";
import type { GamesDb } from "@/lib/games/snapshot.server";
import { isAdmin } from "./reader";
import { replayedGame } from "./review-dto";
import { historicalFullName, historicalShortName } from "./legend-facts";

type ViewerRef = Pick<Viewer, "id" | "role">;
type Side = "w" | "b";

// ── FEN validation ───────────────────────────────────────────────────────────────────────────────────────────────
export type FenProblem = "malformed" | "kings" | "pawn_rank" | "opposite_check";

/** Null when the FEN is a legal practice start, else why not. */
export function fenProblem(fen: string): FenProblem | null {
  const fields = fen.trim().split(/\s+/);
  if (fields.length !== 6) return "malformed";
  const placement = fields[0]!;
  const ranks = placement.split("/");
  if (ranks.length !== 8 || !/^[1-8pnbrqkPNBRQK/]+$/.test(placement)) return "malformed";
  const count = (piece: string) => placement.split("").filter((c) => c === piece).length;
  // The two specific rules first (chess.js rejects both too, but only with a message), then chess.js for the rest.
  if (count("K") !== 1 || count("k") !== 1) return "kings";
  if (/[pP]/.test(ranks[0]!) || /[pP]/.test(ranks[7]!)) return "pawn_rank";
  if (!validateFen(fields.join(" ")).ok) return "malformed";
  // The side that just moved may not be left in check: flip the turn (and drop en passant, which belongs to the
  // other side) and ask whether that side is in check now.
  const flipped = [placement, fields[1] === "w" ? "b" : "w", fields[2], "-", fields[4], fields[5]].join(" ");
  try {
    if (new Chess(flipped).inCheck()) return "opposite_check";
  } catch {
    return "malformed";
  }
  return null;
}

function illegalPosition(problem: FenProblem): ApiError {
  return new ApiError("validation_failed", {
    message: "This position isn’t legal.",
    fields: { fen: "This position isn’t legal" },
    details: { reason: "illegal_position", problem },
  });
}

const sideOf = (fen: string): Side => (fen.trim().split(/\s+/)[1] === "b" ? "b" : "w");
const fromLabelOf = (label: string): string => `Practice · from move ${label.replace(/[.…]$/, "")}`;

// ── ?fen= ────────────────────────────────────────────────────────────────────────────────────────────────────────
export function fenContext(fen: string): PracticeContextDTO {
  const problem = fenProblem(fen);
  if (problem) throw illegalPosition(problem);
  const normalized = new Chess(fen.trim()).fen();
  const side = sideOf(normalized);
  return {
    source: "fen",
    fen: normalized,
    sideToMove: side,
    humanColor: side,
    title: "Practice from a position",
    fromLabel: null,
    botElo: PRACTICE_BOT_ELO,
    backHref: "/play",
    compareHref: null,
    planLine: null,
  };
}

// ── ?position= ───────────────────────────────────────────────────────────────────────────────────────────────────
type PositionRow = {
  referenceId: string;
  fen: string;
  moveNumber: number | null;
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  tournamentName: string | null;
  eventYear: number | null;
};

export function positionSql(ref: string): Prisma.Sql {
  return Prisma.sql`SELECT "referenceId", fen, "moveNumber", "whitePlayerName", "blackPlayerName", "tournamentName",
    EXTRACT(YEAR FROM "eventDate")::int AS "eventYear"
    FROM chess_positions WHERE "referenceId" = ${ref}`;
}

export function positionContextOf(row: PositionRow): PracticeContextDTO {
  const problem = fenProblem(row.fen);
  if (problem) throw new DataError("not_found");
  const fen = new Chess(row.fen.trim()).fen();
  const side = sideOf(fen);
  const players = [row.whitePlayerName?.trim(), row.blackPlayerName?.trim()].filter(Boolean).join(" vs ");
  const event = [row.tournamentName?.trim(), row.eventYear ? String(row.eventYear) : ""].filter(Boolean).join(" ");
  const title = (players || event || "Practice from a position").slice(0, 160);
  const moveNo = row.moveNumber ?? Number(fen.split(" ")[5]);
  return {
    source: "position",
    fen,
    sideToMove: side,
    humanColor: side,
    title,
    fromLabel: Number.isFinite(moveNo) && moveNo > 0 ? `Practice · from move ${moveNo}` : null,
    botElo: PRACTICE_BOT_ELO,
    backHref: `/position/${encodeURIComponent(row.referenceId)}`,
    compareHref: null,
    planLine: null,
  };
}

// ── ?game= ───────────────────────────────────────────────────────────────────────────────────────────────────────
type GameRow = {
  referenceId: string;
  startingFen: string;
  startPly: number;
  moves: string;
  plyCount: number;
  chessPositionId: bigint | null;
  positionName: string | null;
  color: Side;
  opponentName: string;
  comparisonFacts: unknown;
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  whiteLegendName: string | null;
  blackLegendName: string | null;
};

/** One statement: the game, the viewer's player row (an admin reads the White member row, else Black), the facts. */
export function practiceGameSql(viewer: ViewerRef, ref: string): Prisma.Sql {
  return Prisma.sql`
SELECT g."referenceId", g."startingFen", g."startPly", g.moves, g."plyCount", g."chessPositionId",
       g.meta->'position'->>'name' AS "positionName", gp.color, gp."opponentName", lc.facts AS "comparisonFacts",
       cp."whitePlayerName", cp."blackPlayerName", wl.name AS "whiteLegendName", bl.name AS "blackLegendName"
  FROM games g
  JOIN LATERAL (
    SELECT p."userId", p.color, p."opponentName" FROM game_players p
     WHERE p."gameId" = g.id AND (p."userId" = ${viewer.id} OR ${isAdmin(viewer)}::boolean)
     ORDER BY (p."userId" = ${viewer.id}) DESC, p.color DESC
     LIMIT 1) gp ON true
  LEFT JOIN legend_comparisons lc ON lc."gameId" = g.id AND lc."userId" = gp."userId"
  LEFT JOIN chess_positions cp ON cp.id = g."chessPositionId"
  LEFT JOIN legends wl ON wl.id = cp."whitePlayerId"
  LEFT JOIN legends bl ON bl.id = cp."blackPlayerId"
 WHERE g."referenceId" = ${ref} AND g.status IN ('COMPLETED', 'ABORTED')`;
}

export function gameContextOf(row: GameRow, ply: number | undefined): PracticeContextDTO {
  const replay = replayedGame(row.referenceId, row.startingFen, row.moves);
  const at = ply ?? 0;
  const last = Math.min(row.plyCount, replay.uci.length);
  if (at < 0 || (at >= last && at !== 0)) {
    throw new ApiError("validation_failed", { fields: { ply: `Must be between 0 and ${Math.max(0, last - 1)}` } });
  }
  const fen = replay.fens[at] ?? replay.fens[0]!;
  const side = sideOf(fen);
  const label = moveLabel(at, row.startPly);
  const legendGame = row.chessPositionId !== null;
  const facts = legendGame ? parseComparisonFacts(row.comparisonFacts) : null;
  const legendFull = legendGame ? historicalFullName(row, row.color) : null;
  const legendShort = facts?.historicalName ?? (legendFull ? historicalShortName(legendFull) : null);
  const opponent = row.opponentName.trim() || "the engine";
  const title = (
    legendGame && legendShort
      ? `You vs ${legendShort}`
      : row.positionName?.trim() || `Your game vs ${opponent}`
  ).slice(0, 160);
  let planLine: string | null = null;
  if (facts && facts.divergencePly === at && facts.divergenceBy === "user" && facts.legendSan) {
    planLine = `${facts.historicalName} played ${label}${facts.legendSan} here.`.slice(0, 200);
  }
  return {
    source: "game",
    fen,
    sideToMove: side,
    humanColor: row.color,
    title,
    fromLabel: fromLabelOf(label),
    botElo: PRACTICE_BOT_ELO,
    backHref: reviewPath(row.referenceId),
    compareHref: legendGame ? legendComparePath(row.referenceId) : null,
    planLine,
  };
}

/** PR1 / the `/practice` first paint. */
export async function getPracticeContext(db: GamesDb, viewer: ViewerRef, target: PracticeTarget): Promise<PracticeContextDTO> {
  switch (target.source) {
    case "fen":
      return fenContext(target.fen);
    case "position": {
      const rows = await db.$queryRaw<PositionRow[]>(positionSql(target.position));
      const row = rows[0];
      if (!row) throw new DataError("not_found");
      return positionContextOf(row);
    }
    case "game": {
      const rows = await db.$queryRaw<GameRow[]>(practiceGameSql(viewer, target.game));
      const row = rows[0];
      if (!row) throw new DataError("not_found");
      return gameContextOf(row, target.ply);
    }
  }
}
