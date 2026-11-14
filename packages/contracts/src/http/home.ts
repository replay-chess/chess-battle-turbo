// HTTP contract of Home (phase-05 plan §4.1, §7.1 HOME-1 `GET /api/home`, §9.4: ≤ 6 KB raw, ≤ 2.5 KB gzip).
// The registry entry lives in registry/home.ts. Shell states (`payment_failed`, `trial`) come from the viewer
// payload, not from here; `import_running` is `import !== null`; `loading` is the page's loading.tsx.
// Every label is formatted on the server in the viewer's zone.
import { z } from "zod";
import { Color, FenLoose, Ref } from "./common";
import { ItemKey, LastMove, NextBatch } from "./train";

export const HOME_RECENT_MAX = 8;
export const HOME_BANK_THUMBS = 4;

export const GameResultW = z.enum(["win", "loss", "draw"]);
export type GameResultW = z.infer<typeof GameResultW>;

export const HomeContinue = z.object({
  /** `moments`: the first key moment on the board; `clean`: no moments ("Clean game · accuracy 92"); `analysing`. */
  kind: z.enum(["moments", "clean", "analysing"]),
  gameRef: Ref,
  /** The position before the first key moment (replayed on the server), else the final position. */
  fen: FenLoose,
  orient: Color,
  lastMove: LastMove.nullable(),
  opponent: z.string().max(40),
  opponentRating: z.number().int().nullable(),
  result: GameResultW,
  /** "You lost on move 28." */
  endMove: z.number().int().min(0),
  openingName: z.string().max(120).nullable(),
  /** "today", "yesterday", "Oct 27". */
  whenLabel: z.string().max(16),
  keyMomentCount: z.number().int().min(0).max(3),
  accuracy: z.number().int().min(0).max(100).nullable(),
  analysis: z.object({
    status: z.enum(["queued", "running", "done", "failed"]),
    done: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
});
export type HomeContinue = z.infer<typeof HomeContinue>;

/** `new_user`: the featured legend position ("Play the Opera Game", `/position/[ref]` until P8). */
export const HomeStartHere = z.object({
  href: z.string().startsWith("/").max(200),
  fen: FenLoose,
  orient: Color,
  title: z.string().max(80),
  blurb: z.string().max(300),
  ariaLabel: z.string().max(160),
});
export type HomeStartHere = z.infer<typeof HomeStartHere>;

export const HomeBankThumb = z.object({ cardRef: ItemKey, fen: FenLoose, orient: Color, label: z.string().max(120) });
export type HomeBankThumb = z.infer<typeof HomeBankThumb>;

export const HomeBank = z.object({
  due: z.number().int().min(0),
  total: z.number().int().min(0),
  /** "Review 4 · About 3 min": round(0.75 n), min 1. */
  estMin: z.number().int().min(0),
  /** "Loose pieces is your most common theme (7 in bank)." */
  topTheme: z.object({ label: z.string().max(40), n: z.number().int().min(0) }).nullable(),
  thumbs: z.array(HomeBankThumb).max(HOME_BANK_THUMBS),
  nextBatch: NextBatch.nullable(),
});
export type HomeBank = z.infer<typeof HomeBank>;

export const HomeWeek = z.object({
  /** Monday → Sunday of the local week: played or trained that day. */
  days: z.array(z.boolean()).length(7),
  games: z.number().int().min(0),
  puzzles: z.number().int().min(0),
  /** "Played Monday to Thursday this week". */
  aria: z.string().max(120),
});
export type HomeWeek = z.infer<typeof HomeWeek>;

export const HomeRecentGame = z.object({
  gameRef: Ref,
  result: GameResultW,
  opponent: z.string().max(40),
  opponentRating: z.number().int().nullable(),
  /** `GamePlayer.headline` ("Missed Rxf5 · move 19"). */
  chip: z.string().max(80).nullable(),
  dateLabel: z.string().max(16),
});
export type HomeRecentGame = z.infer<typeof HomeRecentGame>;

/** P4's import status, reduced to the Home row ("IMPORTING 212 / 480 GAMES · Chess.com · about 2 min left"). */
export const HomeImport = z.object({
  provider: z.enum(["chesscom", "lichess"]),
  imported: z.number().int().min(0),
  total: z.number().int().min(0).nullable(),
  etaSec: z.number().int().min(0).nullable(),
});
export type HomeImport = z.infer<typeof HomeImport>;

export const HomeData = z.object({
  state: z.enum(["populated", "new_user"]),
  greeting: z.object({ part: z.enum(["morning", "afternoon", "evening"]), name: z.string().max(40) }),
  /** P9 adds ratingLabel. */
  stats: z.object({ gamesThisWeek: z.number().int().min(0) }),
  continue: HomeContinue.nullable(),
  startHere: HomeStartHere.nullable(),
  bank: HomeBank,
  week: HomeWeek,
  recent: z.array(HomeRecentGame).max(HOME_RECENT_MAX),
  import: HomeImport.nullable(),
  hasLinkedAccount: z.boolean(),
});
export type HomeData = z.infer<typeof HomeData>;
