// The one rule for a legend game's comparison facts (phase-03 plan §8.9, P3-D24). Every writer (the web's bot
// `complete` and A2/A9 lazy insert, the worker at load time, the DB backfill) calls `legendFactsOf` and inserts with
// `ON CONFLICT ("gameId", "userId") DO NOTHING`, so whoever writes first wins and all of them write the same row.
//
// Which legend: the historical player on the MEMBER's side of the legend position. Their full name is the linked
// `legends` record's name when that side links one, else the position's player name; a placeholder ("?", "Unknown",
// "N/A", …) is no name. The short form the texts use is the surname: "Paul Morphy" → "Morphy", "Kasparov, Garry" →
// "Kasparov" (≤ 40 characters).
//
// A game has a comparison only when that name exists, the game has moves, the legend PGN reaches the game's start
// position and continues past it (a line that ends at the start has nothing to compare), and the legend game's
// result is known (metadata or PGN). Otherwise the reason is returned and nothing is written.
import type { Color } from "../codec";
import { compareWithLegend, HISTORICAL_NAME_MAX, type ComparisonFacts } from "./compare";
import { legendLineFrom, legendResultOf } from "./slice";

/** Placeholder names some seeded positions carry for a side with no real player. */
const NOT_A_NAME = /^(?:\?+|-+|unknown|various|n\/?a|none)$/i;

/** A real player name (whitespace collapsed), or null for an empty or placeholder value. */
export function realPlayerName(name: string | null | undefined): string | null {
  const trimmed = (name ?? "").trim().replace(/\s+/g, " ");
  return trimmed && !NOT_A_NAME.test(trimmed) ? trimmed : null;
}

/** "Paul Morphy" → "Morphy"; "Kasparov, Garry" → "Kasparov"; ≤ 40 characters. */
export function historicalShortName(full: string): string {
  const name = full.trim().replace(/\s+/g, " ");
  const comma = name.indexOf(",");
  const surname = comma > 0 ? name.slice(0, comma).trim() : (name.split(" ").pop() ?? name);
  return (surname || name).slice(0, HISTORICAL_NAME_MAX);
}

/** The names a legend position carries: the linked `legends` records' names (if any) and the position's own. */
export interface LegendNames {
  whiteLegendName?: string | null;
  blackLegendName?: string | null;
  whitePlayerName: string | null;
  blackPlayerName: string | null;
}

/** The full historical name on one side: the linked legend record, else the position's player name. */
export function historicalFullName(names: LegendNames, side: Color): string | null {
  return side === "w"
    ? (realPlayerName(names.whiteLegendName) ?? realPlayerName(names.whitePlayerName))
    : (realPlayerName(names.blackLegendName) ?? realPlayerName(names.blackPlayerName));
}

export interface LegendFactsInput {
  names: LegendNames;
  /** The position's PGN (the legend game). */
  pgn: string | null;
  /** The position's `gameMetadata` (the legend game's result, when the PGN has none). */
  gameMetadata: unknown;
  /** The position's `moveNumber` (where the game starts in the legend PGN), when known. */
  moveNumber: number | null;
  startFen: string;
  startPly: number;
  /** The game's UCI moves from `startFen`. */
  moves: readonly string[];
  member: Color;
}

export type LegendFactsSkip =
  | "no_name"
  | "no_pgn"
  | "no_moves"
  | "no_line"
  | "line_ends_at_start"
  | "no_result"
  | "bad_moves";

export type LegendFactsOutcome = { ok: true; facts: ComparisonFacts } | { ok: false; reason: LegendFactsSkip };

/** The facts for one member side of a legend game, or why there are none. Pure; validate with ComparisonFactsV1. */
export function legendFactsOf(input: LegendFactsInput): LegendFactsOutcome {
  const full = historicalFullName(input.names, input.member);
  if (!full) return { ok: false, reason: "no_name" };
  if (!input.pgn || input.pgn.trim() === "") return { ok: false, reason: "no_pgn" };
  if (input.moves.length === 0) return { ok: false, reason: "no_moves" };
  const line = legendLineFrom(input.pgn, input.startFen, input.moveNumber ?? undefined);
  if (!line) return { ok: false, reason: "no_line" };
  if (line.uci.length === 0) return { ok: false, reason: "line_ends_at_start" };
  const meta =
    input.gameMetadata && typeof input.gameMetadata === "object" && !Array.isArray(input.gameMetadata)
      ? (input.gameMetadata as Record<string, unknown>)
      : null;
  const legendResult = legendResultOf(input.pgn, meta);
  if (!legendResult) return { ok: false, reason: "no_result" };
  try {
    return {
      ok: true,
      facts: compareWithLegend({
        startFen: input.startFen,
        startPly: input.startPly,
        moves: input.moves,
        member: input.member,
        legendUci: line.uci,
        historicalName: historicalShortName(full),
        legendResult,
        legendTotalMoves: line.totalMoves,
      }),
    };
  } catch {
    // Stored moves that do not replay (legacy data) have no comparison rather than a wrong one.
    return { ok: false, reason: "bad_moves" };
  }
}
