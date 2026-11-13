// Chess.com Published-Data API shapes (phase-04 plan §7.8, §8.6; replaces WEB/lib/types/chess-com.ts, §3), as zod
// schemas in two modes:
//
// - `lenient` (clients, the worker, the web): unknown keys are stripped; a field our code reads that is missing or of
//   the wrong type fails that document (one archive game → `parse_error`, not the whole month).
// - `strict` (the provider canary, §12.5b): unknown keys and unknown enum values fail too, so a provider change shows
//   up in the nightly job before it shows up as skipped games.
//
// Field sets were checked against live responses on 2026-11-12 (profile, stats, archives, one month; the recorded
// fixture under `@repo/chess-fixtures/import/chesscom/recorded/`).
import { z } from "zod";

export type SchemaMode = "lenient" | "strict";

/** Every `result` code an archive game can carry (Chess.com API docs, "Game results codes"). */
export const CHESSCOM_RESULT_CODES = [
  "win",
  "checkmated",
  "agreed",
  "repetition",
  "timeout",
  "resigned",
  "stalemate",
  "lose",
  "insufficient",
  "50move",
  "abandoned",
  "kingofthehill",
  "threecheck",
  "timevsinsufficient",
  "bughousepartnerlose",
] as const;
export type ChessComResultCode = (typeof CHESSCOM_RESULT_CODES)[number];

export const CHESSCOM_RULES = ["chess", "chess960", "bughouse", "kingofthehill", "threecheck", "crazyhouse"] as const;

/** The draw codes (both sides carry one when neither won). */
export const CHESSCOM_DRAW_CODES: ReadonlySet<string> = new Set([
  "agreed",
  "repetition",
  "stalemate",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);

function build(mode: SchemaMode) {
  const strict = mode === "strict";
  const obj = <S extends z.ZodRawShape>(shape: S) => (strict ? z.strictObject(shape) : z.object(shape));
  const oneOf = <T extends readonly [string, ...string[]]>(values: T) => (strict ? z.enum(values) : z.string());
  const int = z.number().int();
  const unixSeconds = int.nonnegative();

  const profile = obj({
    "@id": z.string(),
    url: z.string(),
    username: z.string(),
    player_id: int,
    status: z.string(),
    name: z.string().optional(),
    title: z.string().optional(),
    avatar: z.string().optional(),
    followers: int.optional(),
    country: z.string().optional(),
    location: z.string().optional(),
    last_online: unixSeconds.optional(),
    joined: unixSeconds.optional(),
    is_streamer: z.boolean().optional(),
    twitch_url: z.string().optional(),
    verified: z.boolean().optional(),
    league: z.string().optional(),
    streaming_platforms: z.array(z.unknown()).optional(),
    fide: int.optional(),
  });

  const ratingPoint = obj({ rating: int, date: unixSeconds, rd: int.optional() });
  const bestPoint = obj({ rating: int, date: unixSeconds, game: z.string().optional() });
  const record = obj({
    win: int,
    loss: int,
    draw: int,
    time_per_move: int.optional(),
    timeout_percent: z.number().optional(),
  });
  const tournament = obj({
    points: int.optional(),
    withdraw: int.optional(),
    count: int.optional(),
    highest_finish: int.optional(),
  });
  const classStats = obj({
    last: ratingPoint,
    best: bestPoint.optional(),
    record,
    tournament: tournament.optional(),
  });
  const stats = obj({
    chess_rapid: classStats.optional(),
    chess_blitz: classStats.optional(),
    chess_bullet: classStats.optional(),
    chess_daily: classStats.optional(),
    chess960_daily: classStats.optional(),
    fide: int.optional(),
    tactics: z.unknown().optional(),
    puzzle_rush: z.unknown().optional(),
    lessons: z.unknown().optional(),
  });

  const archives = obj({ archives: z.array(z.string()) });

  const player = obj({
    username: z.string(),
    rating: int,
    result: oneOf(CHESSCOM_RESULT_CODES),
    "@id": z.string(),
    uuid: z.string().optional(),
  });
  const game = obj({
    url: z.string(),
    pgn: z.string(),
    time_control: z.string(),
    end_time: unixSeconds,
    rated: z.boolean(),
    uuid: z.string(),
    fen: z.string(),
    time_class: oneOf(["bullet", "blitz", "rapid", "daily"] as const),
    rules: oneOf(CHESSCOM_RULES),
    white: player,
    black: player,
    initial_setup: z.string().optional(),
    tcn: z.string().optional(),
    start_time: unixSeconds.optional(),
    eco: z.string().optional(),
    accuracies: obj({ white: z.number(), black: z.number() }).optional(),
    match: z.string().optional(),
    tournament: z.string().optional(),
  });
  /** Games are validated one by one (`game`), so one odd game never fails its month. */
  const month = obj({ games: z.array(z.unknown()) });

  return { profile, stats, archives, game, month, player, classStats };
}

const LENIENT = build("lenient");
const STRICT = build("strict");

export const chessComSchemas = (mode: SchemaMode = "lenient") => (mode === "strict" ? STRICT : LENIENT);

export type ChessComProfile = z.infer<typeof LENIENT.profile>;
export type ChessComStats = z.infer<typeof LENIENT.stats>;
export type ChessComClassStats = z.infer<typeof LENIENT.classStats>;
export type ChessComArchives = z.infer<typeof LENIENT.archives>;
export type ChessComArchiveGame = z.infer<typeof LENIENT.game>;
export type ChessComArchivePlayer = z.infer<typeof LENIENT.player>;

/** `"2026/10"`: the month key of `import_cursors.archives` (`ArchivesV1`, §6.4). */
export type MonthKey = `${number}/${string}`;

/** Lookup / confirm preview for the UI (the shape `WEB/lib/types/chess-com.ts` had, §3 "Move"). */
export interface ChessComPreviewData {
  profile: {
    avatar: string | null;
    name: string;
    username: string;
    title: string | null;
    country: string | null;
    followers: number | null;
    isStreamer: boolean;
  };
  ratings: {
    rapid: number | null;
    blitz: number | null;
    bullet: number | null;
    daily: number | null;
  };
  /** All-time rated games over rapid, blitz, bullet and daily (D4-08 "480 rated games"). */
  ratedGames: number;
}
