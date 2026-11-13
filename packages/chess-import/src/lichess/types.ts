// Lichess API shapes (phase-04 plan §7.8, §8.7) as zod schemas in two modes, like the Chess.com ones:
// `lenient` (strip unknown keys; a missing field we read fails that game only) and `strict` (the canary, §12.5b:
// unknown keys and enum values fail). Field sets were checked against the live export
// (`/api/games/user/{u}?…&pgnInJson=false&tags=false`, NDJSON) on 2026-11-12.
import { z } from "zod";
import type { SchemaMode } from "../chesscom/types";

export type { SchemaMode };

/** Every game `status` Lichess sends (scalachess `Status`). */
export const LICHESS_STATUSES = [
  "created",
  "started",
  "aborted",
  "mate",
  "resign",
  "stalemate",
  "timeout",
  "draw",
  "outoftime",
  "cheat",
  "noStart",
  "unknownFinish",
  "insufficientMaterialClaim",
  "variantEnd",
] as const;
export type LichessStatus = (typeof LICHESS_STATUSES)[number];

export const LICHESS_VARIANTS = [
  "standard",
  "chess960",
  "crazyhouse",
  "antichess",
  "atomic",
  "horde",
  "kingOfTheHill",
  "racingKings",
  "threeCheck",
  "fromPosition",
] as const;

export const LICHESS_TITLES = ["GM", "WGM", "IM", "WIM", "FM", "WFM", "NM", "CM", "WCM", "WNM", "LM", "BOT"] as const;

function build(mode: SchemaMode) {
  const strict = mode === "strict";
  const obj = <S extends z.ZodRawShape>(shape: S) => (strict ? z.strictObject(shape) : z.object(shape));
  const oneOf = <T extends readonly [string, ...string[]]>(values: T) => (strict ? z.enum(values) : z.string());
  const int = z.number().int();

  const lightUser = obj({
    id: z.string(),
    name: z.string(),
    title: oneOf(LICHESS_TITLES).optional(),
    flair: z.string().optional(),
    patron: z.boolean().optional(),
    patronColor: int.optional(),
  });
  const playerAnalysis = obj({
    inaccuracy: int,
    mistake: int,
    blunder: int,
    acpl: int,
    accuracy: int.optional(),
  });
  const player = obj({
    user: lightUser.optional(),
    aiLevel: int.optional(),
    rating: int.optional(),
    ratingDiff: int.optional(),
    provisional: z.boolean().optional(),
    analysis: playerAnalysis.optional(),
    team: z.string().optional(),
    berserk: z.boolean().optional(),
    name: z.string().optional(),
  });
  const judgment = obj({ name: z.string(), comment: z.string() });
  const analysisEntry = obj({
    eval: int.optional(),
    mate: int.optional(),
    best: z.string().optional(),
    variation: z.string().optional(),
    judgment: judgment.optional(),
  });
  const game = obj({
    id: z.string().regex(/^[A-Za-z0-9]{8}$/),
    rated: z.boolean(),
    variant: oneOf(LICHESS_VARIANTS),
    speed: oneOf(["ultraBullet", "bullet", "blitz", "rapid", "classical", "correspondence"] as const),
    perf: z.string(),
    createdAt: int,
    lastMoveAt: int,
    status: oneOf(LICHESS_STATUSES),
    source: z.string().optional(),
    players: obj({ white: player, black: player }),
    winner: z.enum(["white", "black"]).optional(),
    opening: obj({ eco: z.string(), name: z.string(), ply: int }).optional(),
    moves: z.string(),
    clocks: z.array(int).optional(),
    clock: obj({ initial: int, increment: int, totalTime: int }).optional(),
    daysPerTurn: int.optional(),
    analysis: z.array(analysisEntry).optional(),
    initialFen: z.string().optional(),
    tournament: z.string().optional(),
    swiss: z.string().optional(),
    division: z.unknown().optional(),
    lastFen: z.string().optional(),
    lastMove: z.string().optional(),
  });

  const perf = obj({
    games: int,
    rating: int,
    rd: int,
    prog: int,
    prov: z.boolean().optional(),
    rank: int.optional(),
  });
  /** `GET /api/account` (OAuth callback, WEB/lib/accounts/lichess.ts) and `GET /api/user/{u}`. */
  const account = obj({
    id: z.string(),
    username: z.string(),
    perfs: z.record(z.string(), z.unknown()).optional(),
    title: oneOf(LICHESS_TITLES).optional(),
    flair: z.string().optional(),
    createdAt: int.optional(),
    seenAt: int.optional(),
    disabled: z.boolean().optional(),
    tosViolation: z.boolean().optional(),
    closed: z.boolean().optional(),
    patron: z.boolean().optional(),
    patronColor: int.optional(),
    verified: z.boolean().optional(),
    profile: z.unknown().optional(),
    playTime: z.unknown().optional(),
    url: z.string().optional(),
    count: z.unknown().optional(),
    followable: z.boolean().optional(),
    following: z.boolean().optional(),
    blocking: z.boolean().optional(),
    streaming: z.boolean().optional(),
    streamer: z.unknown().optional(),
    playing: z.string().optional(),
  });

  return { game, account, perf, analysisEntry, player };
}

const LENIENT = build("lenient");
const STRICT = build("strict");

export const lichessSchemas = (mode: SchemaMode = "lenient") => (mode === "strict" ? STRICT : LENIENT);

export type LichessGame = z.infer<typeof LENIENT.game>;
export type LichessPlayer = z.infer<typeof LENIENT.player>;
export type LichessAnalysisEntry = z.infer<typeof LENIENT.analysisEntry>;
export type LichessAccount = z.infer<typeof LENIENT.account>;
export type LichessPerf = z.infer<typeof LENIENT.perf>;
