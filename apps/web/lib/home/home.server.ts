// HOME-1 `GET /api/home` and the `/home` RSC seed (phase-05 plan §7.3 HOME-1, §4.1, §5.2 S1). One parallel batch:
//
//   h1  the 3 newest finished games with the first key moment's ply and the analysis progress
//       (game_players_userId_endedAt_gameId_idx, PK joins, one JSON path read on ≤ 3 rows)
//   h2  the training state (statement (a), profile, the week's training_days), the due preview (statement (c)) and the
//       top bank theme (theme_mastery_pkey prefix)
//   h3  this week's games (≤ 50 `endedAt` rows) and this week's graded puzzles (training_attempts_userId_reviewedAt_idx)
//   h4  the 8 newest games for "Recent games"
//   h5  P4's import status (one statement)
//   h6  only for a new member: the featured legend position, through the data cache (`positions` tag; 0 DB on a hit)
//
// Continue = the newest analysed game with key moments (its first moment on the board), else the newest still being
// analysed, else the newest analysed clean game. The board FEN is replayed on the server (chess.js); only the FEN
// leaves. Every label is formatted here in the viewer's zone. Reads only.
import { Prisma } from "@repo/db";
import type { HomeData } from "@repo/contracts/http/home";
import { HOME_BANK_THUMBS, HOME_RECENT_MAX } from "@repo/contracts/http/home";
import { estimateMinutes, greetingPart, playedAtLabel, WEEKDAYS_LONG } from "@repo/chess-training/labels";
import { dayKey, weekKeys } from "@repo/chess-training/day";
import { themePluralLabel } from "@repo/chess-training/themes";
import { cachedData } from "@/lib/api/context";
import type { Viewer } from "@/lib/auth/viewer";
import { getImportStatus } from "@/lib/data/imports";
import { capOf } from "@/lib/train/badges.server";
import { nextBatchOf } from "@/lib/train/bank.server";
import { isTrainedDay, loadTrainState, timeZoneOf, trainClock } from "@/lib/train/day.server";
import { asDate, at, num, trainDeps, type TrainDeps } from "@/lib/train/db.server";
import { lastMoveOf } from "@/lib/train/dto.server";
import { duePreviewOf, duePreviewSql, type PreviewRow } from "@/lib/train/today.server";
import { replayMoves } from "@/lib/services/analysis/review-dto";

// ── Statements ──────────────────────────────────────────────────────────────────────────────────────────────────
/** h1: the newest finished games with their analysis and first moment (≤ 3). */
export function continueGamesSql(userId: bigint): Prisma.Sql {
  return Prisma.sql`SELECT g."referenceId" AS ref, gp.color, gp.result::text AS result, gp."endedAt", gp."opponentName",
      gp."opponentRating", gp."momentsCount", gp.accuracy, g."analysisStatus"::text AS "analysisStatus", g."plyCount",
      g."openingName", g."startingFen", g."startPly", g.moves, ga."gradedPlies", ga."totalPlies",
      (pr.content #>> '{moments,0,ply}')::int AS "kPly"
    FROM game_players gp JOIN games g ON g.id = gp."gameId"
    LEFT JOIN game_analyses ga ON ga."gameId" = gp."gameId"
    LEFT JOIN player_reviews pr ON pr."gameId" = gp."gameId" AND pr.color = gp.color
    WHERE gp."userId" = ${userId} AND gp."endedAt" IS NOT NULL
    ORDER BY gp."endedAt" DESC, gp."gameId" DESC LIMIT 3`;
}

/** h4: Recent games (≤ 8). */
export function recentGamesSql(userId: bigint): Prisma.Sql {
  return Prisma.sql`SELECT g."referenceId" AS ref, gp.result::text AS result, gp."opponentName", gp."opponentRating", gp.headline,
      gp."endedAt"
    FROM game_players gp JOIN games g ON g.id = gp."gameId"
    WHERE gp."userId" = ${userId} AND gp."endedAt" IS NOT NULL
    ORDER BY gp."endedAt" DESC, gp."gameId" DESC LIMIT ${HOME_RECENT_MAX}`;
}

/** h3: this week's game ends (≤ 50 rows). */
export function weekGamesSql(userId: bigint, from: Date): Prisma.Sql {
  return Prisma.sql`SELECT gp."endedAt" FROM game_players gp
    WHERE gp."userId" = ${userId} AND gp."endedAt" >= ${at(from)} ORDER BY gp."endedAt" DESC LIMIT 50`;
}

/** h3: this week's graded puzzles. */
export function weekPuzzlesSql(userId: bigint, from: Date): Prisma.Sql {
  return Prisma.sql`SELECT count(*)::int AS n FROM training_attempts
    WHERE "userId" = ${userId} AND "reviewedAt" >= ${at(from)} AND deck = 'PUZZLE' AND grade IS NOT NULL`;
}

/** h2: the theme with the most live BANK cards. */
export function topThemeSql(userId: bigint): Prisma.Sql {
  return Prisma.sql`SELECT theme, "bankCount" FROM theme_mastery WHERE "userId" = ${userId} AND "bankCount" > 0
    ORDER BY "bankCount" DESC, theme LIMIT 1`;
}

/** h6: the featured legend position (Morphy's Opera Game when it is seeded, else the newest featured one). */
export const OPERA_FEN = "rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10";
export function startHereSql(): Prisma.Sql {
  return Prisma.sql`SELECT "referenceId" AS ref, fen, "sideToMove", "whitePlayerName", "blackPlayerName", "tournamentName",
      "moveNumber", "eventDate"
    FROM chess_positions WHERE "isActive" = true AND (fen = ${OPERA_FEN} OR featured = true)
    ORDER BY (fen = ${OPERA_FEN}) DESC, "createdAt" DESC LIMIT 1`;
}

type ContinueRow = {
  ref: string;
  color: string;
  result: string | null;
  endedAt: Date;
  opponentName: string;
  opponentRating: number | null;
  momentsCount: number;
  accuracy: number | null;
  analysisStatus: string;
  plyCount: number;
  openingName: string | null;
  startingFen: string;
  startPly: number;
  moves: string;
  gradedPlies: number | null;
  totalPlies: number | null;
  kPly: number | null;
};

type RecentRow = { ref: string; result: string | null; opponentName: string; opponentRating: number | null; headline: string | null; endedAt: Date };

export type StartRow = {
  ref: string;
  fen: string;
  sideToMove: string;
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  tournamentName: string | null;
  moveNumber: number | null;
  eventDate: Date | null;
};

const resultOf = (r: string | null): "win" | "loss" | "draw" => (r === "WIN" ? "win" : r === "LOSS" ? "loss" : "draw");

const ANALYSIS: Record<string, HomeData["continue"] extends infer C ? (C extends { analysis: { status: infer S } } ? S : never) : never> = {
  QUEUED: "queued",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
};

/** The full-move number of the last ply ("You lost on move 28"). */
function endMoveOf(startPly: number, plyCount: number): number {
  return plyCount <= 0 ? 0 : Math.floor((startPly + plyCount - 1) / 2) + 1;
}

export function continueOf(rows: readonly ContinueRow[], now: Date, timeZone: string): HomeData["continue"] {
  const pick =
    rows.find((r) => r.analysisStatus === "DONE" && num(r.momentsCount) > 0) ??
    rows.find((r) => r.analysisStatus === "QUEUED" || r.analysisStatus === "RUNNING") ??
    rows.find((r) => r.analysisStatus === "DONE");
  if (!pick) return null;
  const kind = pick.analysisStatus === "DONE" ? (num(pick.momentsCount) > 0 ? "moments" : "clean") : "analysing";
  const replay = replayMoves(pick.startingFen, pick.moves);
  const k = kind === "moments" && pick.kPly !== null && pick.kPly >= 0 && pick.kPly < replay.fens.length ? pick.kPly : replay.uci.length;
  const fen = replay.fens[k] ?? replay.fens[replay.fens.length - 1]!;
  const total = num(pick.totalPlies ?? pick.plyCount);
  return {
    kind,
    gameRef: pick.ref,
    fen,
    orient: pick.color === "b" ? "b" : "w",
    lastMove: k > 0 ? lastMoveOf(replay.uci[k - 1]) : null,
    opponent: (pick.opponentName ?? "").slice(0, 40),
    opponentRating: pick.opponentRating === null ? null : num(pick.opponentRating),
    result: resultOf(pick.result),
    endMove: endMoveOf(num(pick.startPly), num(pick.plyCount)),
    openingName: pick.openingName ? pick.openingName.slice(0, 120) : null,
    whenLabel: playedAtLabel(asDate(pick.endedAt)!, now, timeZone),
    keyMomentCount: Math.min(3, Math.max(0, num(pick.momentsCount))),
    accuracy: pick.accuracy === null ? null : Math.min(100, Math.max(0, Math.round(num(pick.accuracy)))),
    analysis: {
      status: ANALYSIS[pick.analysisStatus] ?? "queued",
      done: Math.min(total, num(pick.gradedPlies ?? 0)),
      total,
    },
  };
}

export function startHereOf(row: StartRow | undefined): HomeData["startHere"] {
  if (!row) return null;
  const white = row.whitePlayerName ?? "White";
  const black = row.blackPlayerName ?? "Black";
  const side = row.sideToMove === "b" || row.sideToMove === "black" ? "Black" : "White";
  const where = [row.tournamentName, row.eventDate ? String(new Date(row.eventDate).getUTCFullYear()) : null].filter(Boolean).join(", ");
  const opera = row.fen === OPERA_FEN;
  return {
    href: `/position/${row.ref}`,
    fen: row.fen,
    orient: side === "Black" ? "b" : "w",
    title: "Play Your First Legend Position",
    blurb: (opera
      ? "Paris, 1858. Morphy is White and two pieces ahead in development. Study it for 30 seconds, then play it out against someone at your level."
      : `${where ? `${where}. ` : ""}${white} against ${black}. Study it for 30 seconds, then play it out against someone at your level.`
    ).slice(0, 300),
    ariaLabel: (opera ? `Morphy's Opera Game, move ${row.moveNumber ?? 10}. White to move.` : `${white} against ${black}${row.moveNumber ? `, move ${row.moveNumber}` : ""}. ${side} to move.`).slice(0, 160),
  };
}

/** "Played Monday to Thursday this week", "No games yet this week". */
export function weekAria(days: readonly boolean[]): string {
  const on = days.flatMap((d, i) => (d ? [WEEKDAYS_LONG[i]!] : []));
  if (on.length === 0) return "No games yet this week";
  if (on.length === 1) return `Played ${on[0]} this week`;
  const first = days.indexOf(true);
  const last = days.lastIndexOf(true);
  if (on.length === last - first + 1) return `Played ${WEEKDAYS_LONG[first]} to ${WEEKDAYS_LONG[last]} this week`;
  return `Played ${on.slice(0, -1).join(", ")} and ${on[on.length - 1]} this week`;
}

/** HOME-1 at `now`. */
export async function getHomeData(viewer: Viewer, now: Date, deps: TrainDeps = trainDeps()): Promise<HomeData> {
  const { db } = deps;
  const tz = timeZoneOf(viewer);
  // The week's bounds before the profile is read: the default day start (a member's own hour moves them ≤ 6 h).
  const guess = trainClock(now, tz, { dayStartHour: 4, releaseHour: 8 });
  const [continueRows, state, previews, topRows, weekGames, weekPuzzles, recentRows, importStatus] = await Promise.all([
    db.$queryRaw<ContinueRow[]>(continueGamesSql(viewer.id)),
    loadTrainState(db, viewer, now),
    db.$queryRaw<PreviewRow[]>(duePreviewSql(viewer.id, now, HOME_BANK_THUMBS)),
    db.$queryRaw<{ theme: string; bankCount: number }[]>(topThemeSql(viewer.id)),
    db.$queryRaw<{ endedAt: Date }[]>(weekGamesSql(viewer.id, guess.mondayStartUtc)),
    db.$queryRaw<{ n: number }[]>(weekPuzzlesSql(viewer.id, guess.mondayStartUtc)),
    db.$queryRaw<RecentRow[]>(recentGamesSql(viewer.id)),
    getImportStatus(viewer, { db, now }),
  ]);
  const { clock, due, profile } = state;
  const running = importStatus.data.runs.find((r) => r.status === "queued" || r.status === "running" || r.status === "waiting_for_membership");
  const isNew = continueRows.length === 0 && due.total === 0 && !running;
  const startRows = isNew
    ? await cachedData(async () => db.$queryRaw<StartRow[]>(startHereSql()), ["home-start-here"], { tags: ["positions"], revalidate: 86_400 })()
    : [];

  const cap = capOf(due, profile, state.counters);
  const top = topRows[0];
  const gameDays = new Set(weekGames.map((g) => dayKey(asDate(g.endedAt)!, tz, profile.dayStartHour)));
  const trained = new Set(state.week.filter(isTrainedDay).map((r) => r.day));
  const days = weekKeys(clock.today).map((k) => k <= clock.today && (gameDays.has(k) || trained.has(k)));
  const gamesThisWeek = weekGames.filter((g) => asDate(g.endedAt)!.getTime() >= clock.mondayStartUtc.getTime()).length;
  const etaOf = (r: (typeof importStatus.data.runs)[number]): number | null => {
    if (r.total === null || r.imported <= 0 || !r.startedAt) return null;
    const elapsed = (now.getTime() - Date.parse(r.startedAt)) / 1000;
    return elapsed > 0 ? Math.max(0, Math.round((elapsed / r.imported) * (r.total - r.imported))) : null;
  };

  return {
    state: isNew ? "new_user" : "populated",
    greeting: { part: greetingPart(now, tz), name: (viewer.user.name || "").slice(0, 40) },
    stats: { gamesThisWeek },
    continue: continueOf(continueRows, now, tz),
    startHere: isNew ? startHereOf(startRows[0]) : null,
    bank: {
      due: cap.dueShown,
      total: due.total,
      estMin: estimateMinutes({ bank: cap.dueShown }),
      topTheme: top && num(top.bankCount) > 0 ? { label: themePluralLabel(top.theme), n: num(top.bankCount) } : null,
      thumbs: previews.slice(0, Math.min(HOME_BANK_THUMBS, cap.dueShown)).map((p) => {
        const d = duePreviewOf(p);
        return { cardRef: d.cardRef, fen: d.fen, orient: d.orient, label: d.label };
      }),
      nextBatch: nextBatchOf(due, clock.timeZone, clock.now),
    },
    week: { days, games: gamesThisWeek, puzzles: num(weekPuzzles[0]?.n), aria: weekAria(days) },
    recent: recentRows.map((r) => ({
      gameRef: r.ref,
      result: resultOf(r.result),
      opponent: (r.opponentName ?? "").slice(0, 40),
      opponentRating: r.opponentRating === null ? null : num(r.opponentRating),
      chip: r.headline ? r.headline.slice(0, 80) : null,
      dateLabel: playedAtLabel(asDate(r.endedAt)!, now, tz),
    })),
    import: running
      ? { provider: running.provider, imported: running.imported, total: running.total, etaSec: etaOf(running) }
      : null,
    hasLinkedAccount: (viewer.accounts?.length ?? 0) > 0,
  };
}
