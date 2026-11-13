// Pure mappers behind the onboarding Confirm step (phase-04 plan §4.3, §7.3.1 step 4, §8.2, D4-08, D4-26):
//   lookupDataOf(profile, stats)   Chess.com profile + stats → `LookupData` (ACC-2's body and the confirm card);
//   chessComRecent(games, u, max)  the newest rated standard games of a Chess.com month list → `RecentGame[]`;
//   lichessRecent(lines, id, max)  the Lichess `recentGames()` export lines (no moves) → `RecentGame[]`.
// No network, no DB; unit-tested against @repo/chess-fixtures/import.
import type { ChessComProfile, ChessComStats } from "@repo/chess-import/chesscom/types";
import { chessComSchemas, CHESSCOM_DRAW_CODES } from "@repo/chess-import/chesscom/types";
import { extractCountryCode, openingNameFromEcoUrl, ratedGamesTotal } from "@repo/chess-import/chesscom/map";
import { chessComRatings } from "@repo/chess-import/ratings";
import type { Headline, LookupData, RatingsView } from "@repo/contracts/http/accounts";
import { suggestBand, type SuggestProvider } from "@/lib/onboarding/suggest-band";

const NAME_MAX = 80;
const USERNAME_MAX = 40;
const OPPONENT_MAX = 40;
const OPENING_MAX = 80;

export type RecentGame = {
  result: "win" | "loss" | "draw";
  opponentName: string;
  opponentRating: number | null;
  openingName: string | null;
  timeClass: "bullet" | "blitz" | "rapid" | "classical" | "daily";
  endedAt: string;
};

/** Drops control characters and angle brackets (names are rendered as text; this keeps them readable). */
const printable = (ch: string): boolean => {
  const c = ch.charCodeAt(0);
  return c >= 0x20 && c !== 0x7f && ch !== "<" && ch !== ">";
};

const clip = (s: string | null | undefined, max: number): string | null => {
  const t = s ? [...s].filter(printable).join("").trim() : "";
  return t ? t.slice(0, max) : null;
};

/** The pool the band suggestion would pick, as the "Rapid 1184" headline (§7.3.1 step 4). */
export function headlineOf(ratings: RatingsView, provider: SuggestProvider): Headline {
  const s = suggestBand(ratings, provider);
  return s ? { timeClass: s.timeClass, rating: s.displayRating } : null;
}

/** ACC-2's `LookupData` for a found, open profile (`private` is answered without stats). */
export function lookupDataOf(profile: ChessComProfile, stats: ChessComStats): LookupData {
  const ratings = chessComRatings(stats) as RatingsView;
  const total = ratedGamesTotal(stats);
  return {
    status: total === 0 ? "no_games" : "found",
    profile: profileView(profile),
    ratings,
    headline: headlineOf(ratings, "chesscom"),
    totalRatedGames: total,
  };
}

/** A closed profile (410 / `status: closed*`): no stats, no ratings. */
export function privateLookupData(username: string, profile: ChessComProfile | null): LookupData {
  const view = profile
    ? profileView(profile)
    : { username: username.toLowerCase(), displayUsername: username, name: null, avatarUrl: null, countryCode: null, joinedAt: null, title: null };
  return { status: "private", profile: view, ratings: {}, headline: null, totalRatedGames: 0 };
}

function safeUrl(raw: string | undefined): string | null {
  if (!raw || raw.length > 300) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The handle with the member's own casing (D12: "Found hikaru", the plan says "Found Hikaru"). Chess.com's
 * `username` is lowercase; the profile `url` (https://www.chess.com/member/Hikaru) keeps the casing. Used only when
 * it is the same handle, case aside.
 */
export function displayCasing(profile: Pick<ChessComProfile, "username"> & { url?: string | null }): string {
  const last = typeof profile.url === "string" ? profile.url.replace(/\/+$/, "").split("/").pop() ?? "" : "";
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    decoded = last;
  }
  return decoded && decoded.toLowerCase() === profile.username.toLowerCase() ? decoded : profile.username;
}

export function profileView(profile: ChessComProfile): LookupData["profile"] {
  const display = displayCasing(profile).slice(0, USERNAME_MAX);
  const country = extractCountryCode(profile.country);
  return {
    username: display.toLowerCase(),
    displayUsername: display,
    name: clip(profile.name, NAME_MAX),
    avatarUrl: safeUrl(profile.avatar),
    countryCode: country && /^[A-Z]{2}$/.test(country) ? country : null,
    joinedAt: profile.joined ? new Date(profile.joined * 1000).toISOString() : null,
    title: clip(profile.title, 4),
  };
}

/** The newest `max` rated standard games of the member, newest first (raw month bodies, one invalid game skipped). */
export function chessComRecent(games: readonly unknown[], usernameLower: string, max = 5): RecentGame[] {
  const gameSchema = chessComSchemas("lenient").game;
  const out: { at: number; game: RecentGame }[] = [];
  for (const raw of games) {
    const g = gameSchema.safeParse(raw);
    if (!g.success || !g.data.rated || g.data.rules !== "chess") continue;
    const white = g.data.white.username.toLowerCase() === usernameLower;
    const black = g.data.black.username.toLowerCase() === usernameLower;
    if (white === black) continue;
    const me = white ? g.data.white : g.data.black;
    const them = white ? g.data.black : g.data.white;
    const result: RecentGame["result"] = me.result === "win" ? "win" : CHESSCOM_DRAW_CODES.has(me.result) ? "draw" : "loss";
    const tc = g.data.time_class;
    if (tc !== "bullet" && tc !== "blitz" && tc !== "rapid" && tc !== "daily") continue;
    out.push({
      at: g.data.end_time,
      game: {
        result,
        opponentName: clip(them.username, OPPONENT_MAX) ?? "?",
        opponentRating: Number.isInteger(them.rating) ? them.rating : null,
        openingName: clip(openingNameFromEcoUrl(ecoUrlOf(g.data.pgn)), OPENING_MAX),
        timeClass: tc,
        endedAt: new Date(g.data.end_time * 1000).toISOString(),
      },
    });
  }
  return newest(out, max);
}

function newest(list: { at: number; game: RecentGame }[], max: number): RecentGame[] {
  return list
    .sort((a, b) => b.at - a.at)
    .slice(0, max)
    .map((e) => e.game);
}

function ecoUrlOf(pgn: string): string | null {
  const m = /\[ECOUrl "([^"]{1,300})"\]/.exec(pgn);
  return m?.[1] ?? null;
}

const LICHESS_SPEEDS: Record<string, RecentGame["timeClass"]> = {
  ultraBullet: "bullet",
  bullet: "bullet",
  blitz: "blitz",
  rapid: "rapid",
  classical: "classical",
  correspondence: "daily",
};

type LichessLine = {
  rated?: unknown;
  variant?: unknown;
  speed?: unknown;
  lastMoveAt?: unknown;
  createdAt?: unknown;
  winner?: unknown;
  status?: unknown;
  opening?: { name?: unknown } | null;
  players?: Record<"white" | "black", { user?: { id?: unknown; name?: unknown }; rating?: unknown } | undefined>;
};

/** The newest `max` rated standard games of the Lichess user `userId` (lower-case id) from the export lines. */
export function lichessRecent(lines: readonly unknown[], userId: string, max = 5): RecentGame[] {
  const out: { at: number; game: RecentGame }[] = [];
  for (const raw of lines) {
    if (!raw || typeof raw !== "object") continue;
    const g = raw as LichessLine;
    if (g.rated !== true || (g.variant !== undefined && g.variant !== "standard")) continue;
    if (g.status === "aborted" || g.status === "noStart" || g.status === "created" || g.status === "started") continue;
    const tc = typeof g.speed === "string" ? LICHESS_SPEEDS[g.speed] : undefined;
    const at = typeof g.lastMoveAt === "number" ? g.lastMoveAt : typeof g.createdAt === "number" ? g.createdAt : null;
    const w = g.players?.white;
    const b = g.players?.black;
    if (!tc || at === null || !w || !b) continue;
    const isWhite = w.user?.id === userId;
    const isBlack = b.user?.id === userId;
    if (isWhite === isBlack) continue;
    const them = isWhite ? b : w;
    const mine = isWhite ? "white" : "black";
    const result: RecentGame["result"] = g.winner === undefined || g.winner === null ? "draw" : g.winner === mine ? "win" : "loss";
    out.push({
      at,
      game: {
        result,
        opponentName: clip(typeof them.user?.name === "string" ? them.user.name : "Anonymous", OPPONENT_MAX) ?? "Anonymous",
        opponentRating: typeof them.rating === "number" && Number.isInteger(them.rating) ? them.rating : null,
        openingName: clip(typeof g.opening?.name === "string" ? g.opening.name : null, OPENING_MAX),
        timeClass: tc,
        endedAt: new Date(at).toISOString(),
      },
    });
  }
  return newest(out, max);
}
