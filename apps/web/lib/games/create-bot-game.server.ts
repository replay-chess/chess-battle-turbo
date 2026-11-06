// POST /api/games: create a bot game (phase-02 plan §6.6.1, §7.1.1; replaces POST /api/chess/create-ai-game).
//
// Round trips (Vercel iad1, 1–2 ms each): viewer (route) → start pick ∥ rating ∥ bot user (parallel reads) →
// idempotency insert (route) → one batch transaction (the game + its game_players row in one CTE, the position's
// play counter, and for a restart the parent's abort) → the snapshot re-read.
//
// The start follows create-ai-game's rules (`:150-232`): an opening → the opening's side; a legend → the legend's
// side; otherwise the side to move. `color` overrides it; rematch swaps the parent's colour, restart keeps it, and
// both reuse the parent's start. `botElo` defaults to the viewer's displayed rating for the time class (§8.13).
import type { GameCreateBody } from "@repo/contracts/http/games";
import type { GameMetaV1Input } from "@repo/db/json";
import { abortGameSql } from "@repo/db/live";
import { createLiveGameSql, timeClassOf } from "@repo/db/games";
import { Prisma, type PrismaClient } from "@repo/db";
import { defaultBotElo } from "@repo/game-core/bot/strength";
import type { GameSnapshot } from "@repo/game-core/snapshot";
import { Chess } from "chess.js";
import { ApiError } from "@/lib/api/api-error";
import { isBotMode } from "./access.server";
import { loadGameSnapshot, rawDb, readGameRow, type GamesDb } from "./snapshot.server";
import {
  INITIAL_FEN,
  START_OPENING_SELECT,
  START_POSITION_SELECT,
  type Side,
  type StartOpening,
  type StartPosition,
  fenSide,
  legendSideOf,
  metaForInitial,
  metaForOpening,
  metaForPosition,
  openingSide,
  randomStartPosition,
  ratingFor,
} from "./start.server";

/** The legacy bot user (seeded; `create-ai-game` used it as the opponent). Kept as `opponentId` for legacy readers. */
export const BOT_USER_CODE = "CHESS_BOT_001";
/** A bot game nobody touches is swept after 7 days; the legacy expiry column says 24 h (unused by v3). */
export const BOT_GAME_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** What the start resolves to before anything is written. */
export type ResolvedStart = {
  fen: string;
  /** The side the rules give the human ("auto"). */
  autoSide: Side;
  chessPositionId: bigint | null;
  openingId: bigint | null;
  meta: GameMetaV1Input;
};

export type ParentGame = {
  id: bigint;
  status: string;
  mode: string | null;
  plyCount: number;
  humanSide: Side;
  botElo: number | null;
  startingFen: string;
  chessPositionId: bigint | null;
  openingId: bigint | null;
  meta: unknown;
};

/** The human's colour (plan §7.1.1). */
export function resolveColor(
  color: GameCreateBody["color"],
  autoSide: Side,
  reason: GameCreateBody["reason"],
  parent: Pick<ParentGame, "humanSide"> | null,
  random: () => number = Math.random,
): Side {
  if (parent && reason === "rematch") return parent.humanSide === "w" ? "b" : "w";
  if (parent && reason === "restart") return parent.humanSide;
  if (color === "w" || color === "b") return color;
  if (color === "random") return random() < 0.5 ? "w" : "b";
  return autoSide;
}

/** The start of an opening (the opening's side plays the human). */
export function startFromOpening(op: StartOpening): ResolvedStart {
  return { fen: op.fen, autoSide: openingSide(op), chessPositionId: null, openingId: op.id, meta: metaForOpening(op) };
}

/** The start of a chess position; `legendId` picks the legend's side (create-ai-game's legend rule). */
export function startFromPosition(pos: StartPosition, legendId?: bigint | null): ResolvedStart {
  const legendSide = legendSideOf(pos, legendId);
  const autoSide: Side = legendId != null && legendSide ? legendSide : (fenSideOrStored(pos));
  return { fen: pos.fen, autoSide, chessPositionId: pos.id, openingId: null, meta: metaForPosition(pos, legendSide) };
}

function fenSideOrStored(pos: StartPosition): Side {
  const stored = pos.sideToMove?.trim().toLowerCase();
  if (stored === "white" || stored === "w") return "w";
  if (stored === "black" || stored === "b") return "b";
  return fenSide(pos.fen);
}

export function startFromInitial(): ResolvedStart {
  return { fen: INITIAL_FEN, autoSide: "w", chessPositionId: null, openingId: null, meta: metaForInitial() };
}

/** A parent bot game's start, reused by rematch and restart. */
export function startFromParent(parent: ParentGame): ResolvedStart {
  const meta = parent.meta && typeof parent.meta === "object" ? (parent.meta as Record<string, unknown>) : {};
  return {
    fen: parent.startingFen,
    autoSide: parent.humanSide,
    chessPositionId: parent.chessPositionId,
    openingId: parent.openingId,
    meta: {
      v: 1,
      header: typeof meta.header === "string" ? meta.header : "",
      prefixSan: Array.isArray(meta.prefixSan) ? (meta.prefixSan as string[]) : [],
      prefixStartMoveNo: typeof meta.prefixStartMoveNo === "number" ? meta.prefixStartMoveNo : 1,
      position: (meta.position as GameMetaV1Input["position"]) ?? null,
    },
  };
}

/** chess.js must accept the FEN; a stored FEN it rejects is a 422 illegal_position (logged by the caller). */
export function assertLegalFen(fen: string): void {
  try {
    new Chess(fen);
  } catch {
    throw new ApiError("illegal_position", { details: { reason: "fen_rejected" } });
  }
}

// ── reads ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The Prisma client (or a test fake of the same surface). */
export type CreateBotGameDb = Pick<
  PrismaClient,
  "$queryRawUnsafe" | "$executeRawUnsafe" | "$transaction" | "chessPosition" | "opening" | "legend" | "chessComProfile" | "user"
>;

/** Resolves `body.start` (404 for an unknown legend, position or opening). */
export async function resolveStart(db: CreateBotGameDb, start: GameCreateBody["start"]): Promise<ResolvedStart> {
  switch (start.kind) {
    case "initial":
      return startFromInitial();
    case "random_position": {
      const pos = await randomStartPosition(db, null);
      return pos ? startFromPosition(pos) : startFromInitial();
    }
    case "legend": {
      const legend = await db.legend.findUnique({ where: { referenceId: start.legendRef }, select: { id: true } });
      if (!legend) throw new ApiError("not_found", { message: "That legend does not exist." });
      const pos = (await randomStartPosition(db, legend.id)) ?? (await randomStartPosition(db, null));
      return pos ? startFromPosition(pos, legend.id) : startFromInitial();
    }
    case "position": {
      const pos = await db.chessPosition.findUnique({ where: { referenceId: start.positionRef }, select: START_POSITION_SELECT });
      if (!pos) throw new ApiError("not_found", { message: "That position does not exist." });
      return startFromPosition(pos);
    }
    case "opening": {
      const op = await db.opening.findFirst({ where: { referenceId: start.openingRef, isActive: true }, select: START_OPENING_SELECT });
      if (!op) throw new ApiError("not_found", { message: "That opening does not exist." });
      return startFromOpening(op);
    }
  }
}

/** The parent of a rematch/restart: the viewer's own bot game, else 404. */
export async function readParent(db: GamesDb, ref: string, viewerId: bigint): Promise<ParentGame> {
  const row = await readGameRow(db, ref);
  if (!row || !isBotMode(row.mode)) throw new ApiError("not_found", { message: "That game does not exist." });
  const humanSide: Side | null = row.whitePlayerId === viewerId ? "w" : row.blackPlayerId === viewerId ? "b" : null;
  if (!humanSide) throw new ApiError("not_found", { message: "That game does not exist." });
  return {
    id: row.id,
    status: row.status,
    mode: row.mode,
    plyCount: row.plyCount,
    humanSide,
    botElo: row.botElo,
    startingFen: row.startingFen,
    chessPositionId: row.chessPositionId,
    openingId: row.openingId,
    meta: row.meta,
  };
}

// ── create ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type BotGameViewer = { id: bigint; user: { name: string } };

export type CreateBotGameResult = { snapshot: GameSnapshot; ref: string; botElo: number; color: Side };

export async function createBotGame(
  db: CreateBotGameDb,
  viewer: BotGameViewer,
  body: GameCreateBody,
  now: Date,
  random: () => number = Math.random,
): Promise<CreateBotGameResult> {
  if (body.mode === "LEGEND_BOT") {
    throw new ApiError("validation_failed", {
      message: "Legend games are not available yet.",
      fields: { mode: "Not available yet" },
      details: { reason: "mode_not_available" },
    });
  }
  const raw = rawDb(db);
  const parent = body.parentGameRef ? await readParent(raw, body.parentGameRef, viewer.id) : null;
  const timeClass = timeClassOf(body.tc);
  const [start, profile, bot] = await Promise.all([
    parent ? Promise.resolve(startFromParent(parent)) : resolveStart(db, body.start),
    body.botElo !== undefined || parent?.botElo != null
      ? Promise.resolve(null)
      : db.chessComProfile.findUnique({
          where: { userId: viewer.id },
          select: { bulletRating: true, blitzRating: true, rapidRating: true },
        }),
    db.user.findUnique({ where: { code: BOT_USER_CODE }, select: { id: true } }),
  ]);
  assertLegalFen(start.fen);

  const color = resolveColor(body.color, start.autoSide, body.reason, parent, random);
  const myRating = ratingFor(profile, timeClass);
  const botElo = body.botElo ?? parent?.botElo ?? defaultBotElo(myRating);
  const me = { userId: viewer.id, name: viewer.user.name, rating: myRating };
  const { sql, ref } = createLiveGameSql({
    mode: "BOT",
    creatorId: viewer.id,
    opponentId: bot?.id ?? null,
    white: color === "w" ? me : null,
    black: color === "b" ? me : null,
    bot: { elo: botElo, userId: bot?.id ?? null },
    startingFen: start.fen,
    initialTimeSeconds: body.tc?.initialSeconds ?? 0,
    incrementSeconds: body.tc?.incrementSeconds ?? 0,
    untimed: body.tc === null,
    status: "IN_PROGRESS",
    phase: "PLAYING",
    studySeconds: 0,
    rated: false,
    chessPositionId: start.chessPositionId,
    openingId: start.openingId,
    rematchOfId: parent && body.reason === "rematch" ? parent.id : null,
    meta: start.meta,
    expiresAt: new Date(now.getTime() + BOT_GAME_EXPIRY_MS),
    now,
  });

  // Statements as (text, ...values): see rawDb() in snapshot.server.ts.
  const ops: Prisma.PrismaPromise<unknown>[] = [db.$queryRawUnsafe(sql.text, ...sql.values)];
  if (start.chessPositionId != null) {
    ops.push(db.chessPosition.update({ where: { id: start.chessPositionId }, data: { timesPlayed: { increment: 1 } } }));
  }
  if (parent && body.reason === "restart" && parent.status === "IN_PROGRESS" && parent.plyCount < 2) {
    const abort = abortGameSql({ gameId: parent.id, abortedBy: parent.humanSide, endedAt: now });
    ops.push(db.$queryRawUnsafe(abort.text, ...abort.values));
  }
  await db.$transaction(ops);

  const read = await loadGameSnapshot(raw, ref, viewer.id, now.getTime());
  if (!read) throw new Error(`createBotGame: ${ref} was not readable after insert`);
  return { snapshot: read.snapshot, ref, botElo, color };
}
