// Where a game starts, and what is written once at creation (phase-02 plan §6.2 `meta`, §7.1.1 behaviour, §8.19).
// Shared by POST /api/games (create-bot-game.server.ts) and the legacy live writers (chess/create-game,
// matchmaking.service, tournament/find-match), so every new game carries the same header, "Game starts here" prefix
// and position card, and neither the socket session nor the RSC snapshot joins chess_positions/openings later.
// Pure functions plus the Prisma `select` shapes; the callers run the queries (inside their own `tx` when they have one).
import { Prisma, type PrismaClient } from "@repo/db";
import type { GameMetaV1Input } from "@repo/db/json";
import { headerLeft } from "@repo/game-core/rules/describe";
import { Chess } from "chess.js";

import type { Side } from "@repo/contracts/socket/game";

/** The wire colour type (one source: `@repo/contracts/socket/game`). */
export type { Side };

export const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Prisma `select` for a chess position used as a start. */
export const START_POSITION_SELECT = {
  id: true,
  referenceId: true,
  fen: true,
  sideToMove: true,
  pgn: true,
  moveNumber: true,
  whitePlayerName: true,
  blackPlayerName: true,
  whitePlayerId: true,
  blackPlayerId: true,
  tournamentName: true,
  eventDate: true,
  positionType: true,
  whiteLegend: { select: { profilePhotoUrl: true } },
  blackLegend: { select: { profilePhotoUrl: true } },
} as const;

export type StartPosition = {
  id: bigint;
  referenceId: string;
  fen: string;
  sideToMove: string;
  pgn: string | null;
  moveNumber: number | null;
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  whitePlayerId: bigint | null;
  blackPlayerId: bigint | null;
  tournamentName: string | null;
  eventDate: Date | null;
  positionType: string | null;
  whiteLegend?: { profilePhotoUrl: string | null } | null;
  blackLegend?: { profilePhotoUrl: string | null } | null;
};

/** Prisma `select` for an opening used as a start. */
export const START_OPENING_SELECT = {
  id: true,
  referenceId: true,
  eco: true,
  name: true,
  pgn: true,
  fen: true,
  sideToMove: true,
  moveCount: true,
} as const;

export type StartOpening = {
  id: bigint;
  referenceId: string;
  eco: string;
  name: string;
  pgn: string;
  fen: string;
  sideToMove: string;
  moveCount: number;
};

const MAX_PREFIX = 120;
const clip = (s: string | null | undefined, n: number): string | null => {
  const t = s?.trim();
  return t ? t.slice(0, n) : null;
};
const placementAndSide = (fen: string) => fen.trim().split(/\s+/).slice(0, 2).join(" ");

/** "white"/"black"/"w"/"b" → side; anything else → null. */
export function sideOf(value: string | null | undefined): Side | null {
  const v = value?.trim().toLowerCase();
  if (v === "w" || v === "white") return "w";
  if (v === "b" || v === "black") return "b";
  return null;
}

/** Side to move of a FEN. */
export function fenSide(fen: string): Side {
  return fen.trim().split(/\s+/)[1] === "b" ? "b" : "w";
}

/** The legend's side of a position (the white legend wins when both are legends), or null. */
export function legendSideOf(pos: Pick<StartPosition, "whitePlayerId" | "blackPlayerId">, legendId?: bigint | null): Side | null {
  if (legendId != null) {
    if (pos.whitePlayerId === legendId) return "w";
    if (pos.blackPlayerId === legendId) return "b";
  }
  if (pos.whitePlayerId != null) return "w";
  if (pos.blackPlayerId != null) return "b";
  return null;
}

/** An opening's player side: the side that made the last move (opening.service getOpeningPlayerColor). */
export function openingSide(op: Pick<StartOpening, "sideToMove" | "fen">): Side {
  const toMove = sideOf(op.sideToMove) ?? fenSide(op.fen);
  return toMove === "w" ? "b" : "w";
}

/**
 * The SAN moves played before `startingFen` ("Game starts here"), from a PGN that leads to (or through) it. The PGN is
 * replayed from its own root; the prefix ends at the first position whose placement and side equal the start. A PGN
 * that never reaches the start gives no prefix (never a wrong one). At most the last 120 SAN are kept.
 */
export type Prefix = { sans: string[]; startMoveNo: number; /** "9…b5": the last prefix move with its number. */ last: string | null };

export function prefixFromPgn(pgn: string | null | undefined, startingFen: string): Prefix {
  const none: Prefix = { sans: [], startMoveNo: 1, last: null };
  if (!pgn?.trim()) return none;
  try {
    const loaded = new Chess();
    loaded.loadPgn(pgn);
    const history = loaded.history();
    const rootFen = loaded.getHeaders().FEN ?? INITIAL_FEN;
    const walk = new Chess(rootFen);
    const target = placementAndSide(startingFen);
    if (placementAndSide(walk.fen()) === target) return none;
    for (let i = 0; i < history.length; i++) {
      const [, side, , , , full] = walk.fen().split(" ");
      walk.move(history[i]!);
      if (placementAndSide(walk.fen()) === target) {
        const all = history.slice(0, i + 1);
        const sans = all.slice(-MAX_PREFIX);
        const dropped = all.length - sans.length;
        // Fullmove number of the first kept SAN: replay from the root to find it.
        const counter = new Chess(rootFen);
        for (let j = 0; j < dropped; j++) counter.move(all[j]!);
        const startMoveNo = Number(counter.fen().split(" ")[5] ?? "1") || 1;
        const last = `${full ?? "1"}${side === "b" ? "…" : "."}${history[i]}`;
        return sans.every((s) => s.length <= 8) ? { sans, startMoveNo, last } : none;
      }
    }
  } catch {
    // A PGN chess.js cannot read: no prefix.
  }
  return none;
}

/** "after 9…b5" for the last prefix move (≤ 16 chars), or null. */
export function afterLabel(prefix: Prefix): string | null {
  if (!prefix.last) return null;
  const label = `after ${prefix.last}`;
  return label.length <= 16 ? label : null;
}

/** GameMetaV1 input for a chess-position start (legend games, featured and random positions). */
/** Seed rows of opening positions name both players "Various" (no real game): not a legend header. */
const PLACEHOLDER_PLAYER = /^(various|unknown|nn|\?|-)$/i;
const realName = (name: string | null): string | null => {
  const v = clip(name, 60);
  return v && !PLACEHOLDER_PLAYER.test(v.trim()) ? v : null;
};

export function metaForPosition(pos: StartPosition, legendSide: Side | null): GameMetaV1Input {
  const prefix = prefixFromPgn(pos.pgn, pos.fen);
  const white = realName(pos.whitePlayerName);
  const black = realName(pos.blackPlayerName);
  const year = pos.eventDate ? pos.eventDate.getUTCFullYear() : null;
  // An opening position without real players carries the opening's name in tournamentName ("Open Game",
  // "Italian Game - Classical Variation"). regression: FIX-A — the header read "VARIOUS VS VARIOUS".
  const isOpening = (pos.positionType ?? "").toLowerCase().includes("opening");
  const openingTitle = (!white || !black) && isOpening ? clip(pos.tournamentName, 80) : null;
  let header = "";
  if (white && black) header = headerLeft({ kind: "legend", white, black, year });
  else if (openingTitle) {
    header = headerLeft({ kind: "opening", name: openingTitle });
  } else if ((pos.positionType ?? "").toLowerCase().includes("endgame")) {
    header = headerLeft({ kind: "endgame", moveNo: Number(pos.fen.trim().split(/\s+/)[5] ?? "1") || 1 });
  }
  return {
    v: 1,
    header: header.slice(0, 80),
    prefixSan: prefix.sans,
    prefixStartMoveNo: prefix.startMoveNo,
    position:
      white && black
        ? {
            name: `${white} vs ${black}`.slice(0, 80),
            event: clip(pos.tournamentName, 80),
            year,
            afterLabel: afterLabel(prefix),
            legendSide,
          }
        : openingTitle
          ? { name: openingTitle, event: null, year: null, afterLabel: afterLabel(prefix), legendSide: null }
          : null,
  };
}

/** GameMetaV1 input for an opening start ("C50 · Italian Game" + the opening's moves as the prefix). */
export function metaForOpening(op: StartOpening): GameMetaV1Input {
  const prefix = prefixFromPgn(op.pgn, op.fen);
  return {
    v: 1,
    header: headerLeft({ kind: "opening", eco: op.eco, name: op.name }).slice(0, 80),
    prefixSan: prefix.sans,
    prefixStartMoveNo: prefix.startMoveNo,
    position: null,
  };
}

/** The meta of a game from the initial position. */
export function metaForInitial(): GameMetaV1Input {
  return { v: 1, header: "", prefixSan: [], prefixStartMoveNo: 1, position: null };
}

export type RatingProfile = {
  bulletRating: number | null;
  blitzRating: number | null;
  rapidRating: number | null;
} | null;

/** The displayed (Chess.com) rating for a time class, as `create-ai-game` picked it; null without one. */
export function ratingFor(profile: RatingProfile | undefined, timeClass: string): number | null {
  if (!profile) return null;
  switch (timeClass) {
    case "BULLET":
      return profile.bulletRating ?? null;
    case "BLITZ":
      return profile.blitzRating ?? null;
    case "RAPID":
    case "CLASSICAL":
      return profile.rapidRating ?? null;
    default:
      return profile.rapidRating ?? profile.blitzRating ?? null;
  }
}

/** Legacy `gameData.positionInfo` (game-by-ref invite projection, analysis fallback) for a position or opening. */
export function legacyPositionInfo(pos: StartPosition | null, op: StartOpening | null): Record<string, unknown> | null {
  if (op) {
    return {
      whitePlayerName: null,
      blackPlayerName: null,
      tournamentName: null,
      openingName: op.name,
      openingEco: op.eco,
      whitePlayerImageUrl: null,
      blackPlayerImageUrl: null,
    };
  }
  if (!pos) return null;
  return {
    whitePlayerName: pos.whitePlayerName ?? null,
    blackPlayerName: pos.blackPlayerName ?? null,
    tournamentName: pos.tournamentName ?? null,
    whitePlayerImageUrl: pos.whiteLegend?.profilePhotoUrl ?? null,
    blackPlayerImageUrl: pos.blackLegend?.profilePhotoUrl ?? null,
  };
}

// ── reads (callers pass their client, or their `tx` inside a transaction) ───────────────────────────────────────

export type StartDb = Pick<PrismaClient, "$queryRawUnsafe" | "chessPosition" | "opening" | "legend">;

/** A random active position (`ORDER BY random() LIMIT 1` over a few hundred rows), optionally of one legend. */
export function randomPositionSql(legend: bigint | readonly bigint[] | null): Prisma.Sql {
  const ids = legend == null ? [] : Array.isArray(legend) ? [...legend] : [legend as bigint];
  const legendFilter =
    ids.length === 0
      ? Prisma.empty
      : Prisma.sql`AND (p."whitePlayerId" = ANY(${ids}::bigint[]) OR p."blackPlayerId" = ANY(${ids}::bigint[]))`;
  return Prisma.sql`
    SELECT p.id, p."referenceId", p.fen, p."sideToMove", p.pgn, p."moveNumber", p."whitePlayerName", p."blackPlayerName",
           p."whitePlayerId", p."blackPlayerId", p."tournamentName", p."eventDate", p."positionType",
           wl."profilePhotoUrl" AS "whitePhoto", bl."profilePhotoUrl" AS "blackPhoto"
      FROM chess_positions p
      LEFT JOIN legends wl ON wl.id = p."whitePlayerId"
      LEFT JOIN legends bl ON bl.id = p."blackPlayerId"
     WHERE p."isActive" ${legendFilter}
     ORDER BY random() LIMIT 1`;
}

export async function randomStartPosition(
  db: Pick<StartDb, "$queryRawUnsafe">,
  legend: bigint | readonly bigint[] | null,
): Promise<StartPosition | null> {
  // (text, ...values), not $queryRaw(Sql): see rawDb() in snapshot.server.ts.
  const sql = randomPositionSql(legend);
  const rows = await db.$queryRawUnsafe<(StartPosition & { whitePhoto: string | null; blackPhoto: string | null })[]>(sql.text, ...sql.values);
  const row = rows[0];
  if (!row || typeof row.fen !== "string") return null;
  const { whitePhoto, blackPhoto, ...pos } = row;
  return { ...pos, whiteLegend: { profilePhotoUrl: whitePhoto }, blackLegend: { profilePhotoUrl: blackPhoto } };
}

export async function findStartPosition(db: Pick<StartDb, "chessPosition">, referenceId: string): Promise<StartPosition | null> {
  return db.chessPosition.findUnique({ where: { referenceId }, select: START_POSITION_SELECT });
}

export async function findStartOpening(db: Pick<StartDb, "opening">, referenceId: string): Promise<StartOpening | null> {
  return db.opening.findFirst({ where: { referenceId, isActive: true }, select: START_OPENING_SELECT });
}

export async function findLegendId(db: Pick<StartDb, "legend">, referenceId: string): Promise<bigint | null> {
  const legend = await db.legend.findUnique({ where: { referenceId }, select: { id: true } });
  return legend?.id ?? null;
}

/** A legacy start (create-game, matchmaking): what was found, and whether a rule fixed the side. */
export type LegacyStart = {
  fen: string;
  position: StartPosition | null;
  opening: StartOpening | null;
  /** The side the rules give the creator, or null when it is random (no position ref, opening or legend side). */
  ruledSide: Side | null;
  meta: GameMetaV1Input;
};

/**
 * The legacy routes' start rules (create-game before P2): a position by ref (unknown → the initial position), else an
 * opening (unknown → initial), else a legend's random position (none → any random position), else any random position.
 * Tolerant: an unknown ref never fails the request, as before.
 */
export async function resolveLegacyStart(
  db: StartDb,
  req: { positionRef?: string | null; openingRef?: string | null; legendRef?: string | null },
): Promise<LegacyStart> {
  if (req.positionRef) {
    const position = await findStartPosition(db, req.positionRef);
    if (position) {
      return { fen: position.fen, position, opening: null, ruledSide: sideOf(position.sideToMove) ?? fenSide(position.fen), meta: metaForPosition(position, legendSideOf(position)) };
    }
    return { fen: INITIAL_FEN, position: null, opening: null, ruledSide: null, meta: metaForInitial() };
  }
  if (req.openingRef) {
    const opening = await findStartOpening(db, req.openingRef);
    if (opening) return { fen: opening.fen, position: null, opening, ruledSide: openingSide(opening), meta: metaForOpening(opening) };
    return { fen: INITIAL_FEN, position: null, opening: null, ruledSide: null, meta: metaForInitial() };
  }
  if (req.legendRef) {
    const legendId = await findLegendId(db, req.legendRef);
    const own = legendId != null ? await randomStartPosition(db, legendId) : null;
    if (own) {
      const side = legendSideOf(own, legendId);
      return { fen: own.fen, position: own, opening: null, ruledSide: side, meta: metaForPosition(own, side) };
    }
  }
  const any = await randomStartPosition(db, null);
  if (any) return { fen: any.fen, position: any, opening: null, ruledSide: null, meta: metaForPosition(any, legendSideOf(any)) };
  return { fen: INITIAL_FEN, position: null, opening: null, ruledSide: null, meta: metaForInitial() };
}
