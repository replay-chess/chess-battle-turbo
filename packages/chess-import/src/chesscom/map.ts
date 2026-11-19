// One Chess.com archive game → `ImportedGame` (phase-04 plan §8.6 "Mapping one game", pure). The PGN is
// authoritative: it is replayed with chess.js from `initial_setup`, and a final position that disagrees with the
// archive's `fen` makes the game a `parse_error` (never stored half-right).
//
// Filters (§8.6 step 5), in order: `rules ≠ chess` → `variant`; `rated ≠ true` → `unrated`; the member on neither
// side → `not_participant`; an unreadable or illegal PGN, an unknown time class or time control, or a result pair
// that names no winner and no draw → `parse_error`; fewer than 2 plies → `too_short`.
import { INITIAL_FEN, lastClocks, parsePgn, positionKey, replaySan } from "../replay";
import { chessComTimeClass } from "../time-class";
import {
  clip,
  clipWords,
  EXTERNAL_ID_MAX,
  EXTERNAL_URL_MAX,
  NAME_MAX,
  OPENING_NAME_MAX,
  skip,
  TITLE_MAX,
  type ImportEndMethod,
  type ImportOutcome,
  type MapResult,
} from "../types";
import {
  CHESSCOM_DRAW_CODES,
  chessComSchemas,
  type ChessComArchiveGame,
  type ChessComClassStats,
  type ChessComPreviewData,
  type ChessComProfile,
  type ChessComStats,
} from "./types";

export interface ChessComMapContext {
  /** The linked account's username, lower-cased (`linked_accounts."usernameLower"`). */
  usernameLower: string;
  /** The member's own title from their profile (opponents' titles are not in the archive). */
  memberTitle?: string | null;
}

/** Result code of the side that did not win → `GameEndMethod` (§8.6); unlisted codes → OTHER. */
export const CHESSCOM_END_METHODS: Readonly<Record<string, ImportEndMethod>> = {
  checkmated: "CHECKMATE",
  resigned: "RESIGNATION",
  timeout: "TIMEOUT",
  abandoned: "ABANDONED",
  agreed: "AGREEMENT",
  repetition: "THREEFOLD",
  stalemate: "STALEMATE",
  insufficient: "INSUFFICIENT_MATERIAL",
  "50move": "FIFTY_MOVE",
  timevsinsufficient: "TIMEOUT_VS_INSUFFICIENT",
};

export const endMethodOfCode = (code: string): ImportEndMethod => CHESSCOM_END_METHODS[code] ?? "OTHER";

/** `"180+2"` → 180 / 2; `"600"` → 600 / 0; `"1/86400"` (daily, seconds per move) → 86400 / 0. */
export function parseTimeControl(tc: string): { initialTimeSeconds: number; incrementSeconds: number } | null {
  const t = tc.trim();
  let m = /^(\d+)(?:\+(\d+))?$/.exec(t);
  if (m) return { initialTimeSeconds: Number(m[1]), incrementSeconds: Number(m[2] ?? 0) };
  m = /^1\/(\d+)$/.exec(t);
  if (m) return { initialTimeSeconds: Number(m[1]), incrementSeconds: 0 };
  return null;
}

/** `…/game/live/123` or `…/game/daily/456` → the number; else the game's uuid (§8.6). */
export function externalIdOf(url: string, uuid: string): string {
  const m = /\/game\/(live|daily)\/(\d+)$/.exec(url);
  return clip(m ? m[2]! : uuid, EXTERNAL_ID_MAX);
}

/**
 * A hyphen-separated run of k "O" tokens in a slug is castling, at most one move per side (a white move always
 * carries its number, so a run never spans more than white's castle and black's reply):
 *   k=2 "O-O", k=3 "O-O-O", k=4 "O-O O-O", k=6 "O-O-O O-O-O",
 *   k=5 is ambiguous ("O-O-O O-O" or "O-O O-O-O"); the slug carries no position to decide it, so it reads as white
 *   long, black short ("O-O-O O-O") — the only one of the two in the opening book (apps/web/public/openings: 4 vs 0)
 *   and what the old decoder produced for k=5. Longer runs (not legal chess) split into "O-O-O" moves from the left
 *   with the last 2..5 tokens as above. Castling written with zeros ("0-0") is not used by Chess.com slugs.
 */
function castlingOfRun(k: number): string {
  const moves: string[] = [];
  while (k > 6) {
    moves.push("O-O-O");
    k -= 3;
  }
  if (k === 2) moves.push("O-O");
  else if (k === 3) moves.push("O-O-O");
  else if (k === 4) moves.push("O-O", "O-O");
  else if (k === 5) moves.push("O-O-O", "O-O");
  else moves.push("O-O-O", "O-O-O");
  return moves.join(" ");
}

/**
 * `ECOUrl` slug → words: `…/openings/Scandinavian-Defense-Mieses-Kotroc-Variation` → "Scandinavian Defense Mieses
 * Kotroc Variation". Castling keeps its hyphens (`castlingOfRun`); every other hyphen separates words. Markup and
 * control characters are stripped; ≤ 80 chars, cut between words (`clipWords`).
 */
export function openingNameFromEcoUrl(ecoUrl: string | undefined | null): string | null {
  if (!ecoUrl) return null;
  const path = ecoUrl.split(/[?#]/)[0]!.replace(/\/+$/, "");
  let slug = path.slice(path.lastIndexOf("/") + 1);
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // keep the raw slug
  }
  const words = slug
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>"`\\\p{Cc}]/gu, " ")
    // a whole run of "O" tokens at once ("…5.O-O-O-O-6.c3"); \uE000 shields its hyphens from the split below
    .replace(/(^|[^A-Za-z])(O(?:-O)+)(?=$|[^A-Za-z])/g, (_, pre: string, run: string) =>
      pre + castlingOfRun(run.split("-").length).replace(/-/g, "\uE000"),
    )
    .replace(/-/g, " ")
    .replace(/\uE000/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return null;
  return clipWords(words, OPENING_NAME_MAX).trimEnd();
}

/**
 * Read-time repair of an `openingName` stored by the pre-fix decoder, which read a k=4 castling run as "O-O-O O"
 * (both sides castling short, "…5.O-O-O-O-6.c3"). Every other castling run it produced was already right (k=5 →
 * "O-O-O O-O", k=6 → "O-O-O O-O-O"), so this rewrites only a long castle followed by a lone "O" token and returns
 * every other name unchanged — Lichess names never carry castling notation. Idempotent.
 */
export function repairOpeningName(name: string): string;
export function repairOpeningName(name: string | null): string | null;
export function repairOpeningName(name: string | null): string | null {
  if (!name) return name;
  return name.replace(/(^|[^A-Za-z-])O-O-O O(?=$|[^A-Za-z-])/g, "$1O-O O-O");
}

const ECO_RE = /^[A-E]\d\d$/;

export function mapChessComGame(raw: unknown, ctx: ChessComMapContext): MapResult {
  const parsed = chessComSchemas("lenient").game.safeParse(raw);
  if (!parsed.success) return skip("parse_error", "archive game does not match the schema");
  const g: ChessComArchiveGame = parsed.data;
  if (g.rules !== "chess") return skip("variant", `rules ${g.rules}`);
  if (g.rated !== true) return skip("unrated", "unrated game");

  const me = ctx.usernameLower.toLowerCase();
  const color = g.white.username.toLowerCase() === me ? "w" : g.black.username.toLowerCase() === me ? "b" : null;
  if (!color) return skip("not_participant", "the account plays neither side");

  const timeClass = chessComTimeClass(g.time_class);
  if (!timeClass) return skip("parse_error", `time class ${g.time_class}`);
  const tc = parseTimeControl(g.time_control);
  if (!tc) return skip("parse_error", `time control ${g.time_control}`);

  let outcome: ImportOutcome;
  let endMethod: ImportEndMethod;
  if (g.white.result === "win" && g.black.result !== "win") {
    outcome = "WHITE";
    endMethod = endMethodOfCode(g.black.result);
  } else if (g.black.result === "win" && g.white.result !== "win") {
    outcome = "BLACK";
    endMethod = endMethodOfCode(g.white.result);
  } else if (CHESSCOM_DRAW_CODES.has(g.white.result) && CHESSCOM_DRAW_CODES.has(g.black.result)) {
    outcome = "DRAW";
    endMethod = endMethodOfCode(g.white.result);
  } else {
    return skip("parse_error", `result pair ${g.white.result}/${g.black.result}`);
  }

  const pgn = parsePgn(g.pgn);
  if (!pgn.ok) return skip("parse_error", pgn.detail);
  const setup = g.initial_setup?.trim() || pgn.value.headers.FEN || INITIAL_FEN;
  const startingFen = positionKey(setup) === positionKey(INITIAL_FEN) ? INITIAL_FEN : setup;
  const rep = replaySan(startingFen, pgn.value.sans);
  if (!rep.ok) return skip("parse_error", rep.detail);
  const game = rep.game;
  if (positionKey(game.fen) !== positionKey(g.fen)) return skip("parse_error", "archive fen disagrees with the PGN");
  if (game.plyCount < 2) return skip("too_short", `${game.plyCount} plies`);

  const clocks = pgn.value.clocks;
  const moveClocksMs =
    clocks.length === game.plyCount && clocks.every((c): c is number => c !== null) ? clocks : ([] as number[]);
  const last = lastClocks(game.startPly, moveClocksMs);

  const mine = color === "w" ? g.white : g.black;
  const theirs = color === "w" ? g.black : g.white;
  const memberWon = (outcome === "WHITE" && color === "w") || (outcome === "BLACK" && color === "b");
  const result = outcome === "DRAW" ? "DRAW" : memberWon ? "WIN" : "LOSS";
  const title = ctx.memberTitle ? clip(ctx.memberTitle, TITLE_MAX) : null;
  const eco = pgn.value.headers.ECO?.trim();

  return {
    ok: true,
    game: {
      source: "CHESSCOM",
      externalId: externalIdOf(g.url, g.uuid),
      externalUrl: clip(g.url, EXTERNAL_URL_MAX),
      timeClass,
      rated: true,
      endedAt: new Date(g.end_time * 1000),
      createdAtMs: g.start_time != null ? g.start_time * 1000 : null,
      whiteName: clip(g.white.username, NAME_MAX),
      blackName: clip(g.black.username, NAME_MAX),
      whiteRating: g.white.rating,
      blackRating: g.black.rating,
      whiteTitle: color === "w" ? title : null,
      blackTitle: color === "b" ? title : null,
      outcome,
      endMethod,
      legacyResult: result === "WIN" ? "CREATOR_WON" : result === "LOSS" ? "OPPONENT_WON" : "DRAW",
      ecoCode: eco && ECO_RE.test(eco) ? eco : null,
      openingName: openingNameFromEcoUrl(pgn.value.headers.ECOUrl ?? g.eco),
      moves: game.uci.join(" "),
      moveClocksMs,
      plyCount: game.plyCount,
      startPly: game.startPly,
      startingFen: game.startingFen,
      fen: game.fen,
      initialTimeSeconds: tc.initialTimeSeconds,
      incrementSeconds: tc.incrementSeconds,
      creatorTimeRemaining: Math.floor((last[color] ?? 0) / 1000),
      opponentTimeRemaining: Math.floor((last[color === "w" ? "b" : "w"] ?? 0) / 1000),
      memberWon,
      color,
      result,
      ratingBefore: mine.rating,
      ratingDelta: null,
      opponentName: clip(theirs.username, NAME_MAX),
      opponentRating: theirs.rating,
      evalHint: null,
    },
  };
}

/** True for `closed`, `closed:fair_play_violations`, `closed:abuse` … (§8.6 step 1: error `closed`). */
export const isClosedStatus = (status: string): boolean => status === "closed" || status.startsWith("closed:");

/** `https://api.chess.com/pub/country/US` → `"US"`. */
export function extractCountryCode(countryUrl: string | null | undefined): string | null {
  if (!countryUrl) return null;
  const m = /\/country\/(\w+)$/.exec(countryUrl);
  return m?.[1] ?? null;
}

const games = (s: ChessComClassStats | undefined) => (s ? s.record.win + s.record.loss + s.record.draw : 0);

/** All-time rated games over the four standard classes (D4-08). */
export function ratedGamesTotal(stats: ChessComStats): number {
  return games(stats.chess_rapid) + games(stats.chess_blitz) + games(stats.chess_bullet) + games(stats.chess_daily);
}

/** The lookup / confirm card data (the legacy `fetchChessComPreview` mapping, now pure). */
export function previewOf(profile: ChessComProfile, stats: ChessComStats): ChessComPreviewData {
  return {
    profile: {
      avatar: profile.avatar ?? null,
      name: profile.name || profile.username,
      username: profile.username,
      title: profile.title ?? null,
      country: extractCountryCode(profile.country),
      followers: profile.followers ?? null,
      isStreamer: profile.is_streamer ?? false,
    },
    ratings: {
      rapid: stats.chess_rapid?.last.rating ?? null,
      blitz: stats.chess_blitz?.last.rating ?? null,
      bullet: stats.chess_bullet?.last.rating ?? null,
      daily: stats.chess_daily?.last.rating ?? null,
    },
    ratedGames: ratedGamesTotal(stats),
  };
}
