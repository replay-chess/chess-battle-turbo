// Practice from a position (phase-03 plan §4.8, §5.9, §7.1, §7.2 PR1). The `/practice` RSC calls the DAL directly;
// `GET /api/practice/context` serves client callers outside it (P5's "study this position"). The browser engine
// plays; nothing is written on the server.
import { z } from "zod";
import { Color, FenLoose, Ref } from "./common";

// The zod-free practice paths (plain.ts; the client imports them from there).
export { practiceFromFenPath, practiceFromGamePath, practiceFromPositionPath } from "./plain";

/** The engine strength Practice plays at (the board's "Engine 1400 · untimed · not rated"). */
export const PRACTICE_BOT_ELO = 1_400;

/**
 * Flat (so the OpenAPI document lists the parameters), refined to exactly one source: a game ply
 * (`?game=<ref>&ply=<n>`; the viewer must be a player, else 404), a chess position (`?position=<ref>`), or a FEN
 * (`?fen=`; the server validates it: legal, one king each, the side not to move is not in check, else 400
 * `validation_failed` with `details.reason: "illegal_position"`).
 */
export const PracticeQuery = z
  .object({
    game: Ref.optional(),
    ply: z.coerce.number().int().min(0).max(1_200).optional(),
    position: Ref.optional(),
    fen: FenLoose.optional(),
  })
  .superRefine((q, ctx) => {
    const sources = [q.game, q.position, q.fen].filter((v) => v !== undefined).length;
    if (sources !== 1) ctx.addIssue({ code: "custom", path: [], message: "give exactly one of game, position or fen" });
    if (q.ply !== undefined && q.game === undefined) ctx.addIssue({ code: "custom", path: ["ply"], message: "ply needs game" });
  });
export type PracticeQuery = z.infer<typeof PracticeQuery>;

/** The one source of a parsed PracticeQuery. */
export type PracticeTarget =
  | { source: "game"; game: string; ply: number | undefined }
  | { source: "position"; position: string }
  | { source: "fen"; fen: string };

export function practiceTargetOf(q: PracticeQuery): PracticeTarget {
  if (q.game !== undefined) return { source: "game", game: q.game, ply: q.ply };
  if (q.position !== undefined) return { source: "position", position: q.position };
  if (q.fen !== undefined) return { source: "fen", fen: q.fen };
  throw new Error("practiceTargetOf: the query has no source (parse it with PracticeQuery first)");
}

export const PRACTICE_SOURCES = ["game", "position", "fen"] as const;
export const PracticeSource = z.enum(PRACTICE_SOURCES);
export type PracticeSource = z.infer<typeof PracticeSource>;

export const PracticeContextDTO = z.object({
  source: PracticeSource,
  fen: FenLoose,
  sideToMove: Color,
  /** The side the user plays (the side to move unless the source says otherwise). */
  humanColor: Color,
  /** The serif h1: the plan or position title. */
  title: z.string().min(1).max(160),
  /** "Practice · from move 12"; null for a bare FEN. */
  fromLabel: z.string().max(80).nullable(),
  botElo: z.number().int().min(400).max(3_200),
  /** Where Back goes: the review, the comparison or the position's page. */
  backHref: z.string().startsWith("/"),
  /** Only for `?game=` on a legend game. */
  compareHref: z.string().startsWith("/review/").nullable(),
  /** The legend's plan line for the hint card, when known. */
  planLine: z.string().max(200).nullable(),
});
export type PracticeContextDTO = z.infer<typeof PracticeContextDTO>;
