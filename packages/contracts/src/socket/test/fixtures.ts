// Realistic protocol fixtures (phase-02 plan §7.4.6): a 25-character cuid ref, real FENs, 3-digit plies,
// 20-character names, 13-digit epoch-ms times, 6-digit clock values and the longest seeded legend prefix. The schema
// tests parse every fixture; the size tests serialise them; the transcripts and other packages' tests may reuse them.
import type { CommandName, CommandPayload } from "../commands";
import type { GameEventName, GameEventPayload } from "../events";
import type { GameState, PlayerView } from "../game";
import { GAME80_FEN, GAME80_UCI, OPERA80_FEN, OPERA80_UCI, OPERA_PREFIX_SANS, OPERA_START_FEN } from "./moves";

export const T0 = 1_793_563_200_000;
/** 25-character cuids. */
export const GAME_REF = "cm3k9x2p10007slzpqa8hd4fe";
export const NEW_GAME_REF = "cm3k9xq7r0009slzpw2e5bn1k";
export const WHITE_REF = "cm1a7rt0q0002ls8d9x0k4vze";
export const BLACK_REF = "cm1a7s3c10003ls8dh2m7q5yt";
/** 20-character display names. */
export const WHITE_NAME = "lucena_now_blitz2026";
export const BLACK_NAME = "martin_k_of_the_ring";
export const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const CLOCKS = { w: 287_345, b: 291_802, run: "b", at: T0 + 612_345 } as const;

function player(ref: string, name: string, rating: number): PlayerView {
  return {
    ref,
    displayName: name,
    initials: name.slice(0, 2).toUpperCase(),
    // Clerk avatar URLs are 176 characters on the dev database (14 of 19 users with a picture).
    avatarUrl: `https://img.clerk.com/${"eyJ0eXBlIjoicHJveHkiLCJzcmMiOiJodHRwczovL2ltYWdlcy5jbGVyay5kZXYvb2F1dGhfZ29vZ2xlL2ltZ18yZjVu".padEnd(129, "Q")}${ref}`,
    rating,
    isBot: false,
    online: true,
    graceEndsAt: null,
  };
}

function clocksAfter(plies: number): number[] {
  return Array.from({ length: plies }, (_, i) => 300_000 - i * 3_517 + (i % 7) * 1_013);
}

/** A live blitz game in `playing`, from the initial position, 80 plies played (or `start: "opera"`). */
export function gameStateFixture(options: { start?: "initial" | "opera"; plies?: 80 | 0 } = {}): GameState {
  const opera = options.start === "opera";
  const plies = options.plies ?? 80;
  const uci = (opera ? OPERA80_UCI : GAME80_UCI).slice(0, plies);
  const startFen = opera ? OPERA_START_FEN : INITIAL_FEN;
  const startPly = opera ? 18 : 0;
  return {
    v: 2,
    ref: GAME_REF,
    seq: 187,
    serverNow: T0 + 612_345,
    mode: "FRIEND",
    rated: false,
    timeClass: "blitz",
    tc: { initialMs: 300_000, incrementMs: 3_000, label: "5+3" },
    header: opera
      ? { left: "C41 · Philidor Defence · Morphy vs Duke Karl of Brunswick and Count Isouard 1858", right: "Blitz 5+3 · unrated" }
      : { left: "", right: "Blitz 5+3 · unrated" },
    position: opera
      ? {
          name: "Morphy vs Duke Karl of Brunswick and Count Isouard",
          event: "Paris Opera",
          year: 1858,
          sideToMove: "w",
          afterLabel: "after 9…b5",
          legendSide: "w",
        }
      : null,
    startFen,
    startPly,
    prefix: opera
      ? { sans: OPERA_PREFIX_SANS, startMoveNo: 10, startsBlack: false }
      : { sans: "", startMoveNo: 1, startsBlack: false },
    moves: uci.join(" "),
    clocksMs: clocksAfter(uci.length),
    fen: plies === 0 ? startFen : opera ? OPERA80_FEN : GAME80_FEN,
    turn: "w",
    inCheck: false,
    phase: "playing",
    study: null,
    firstMove: null,
    clocks: { ...CLOCKS, run: "w" },
    frozen: null,
    players: { w: player(WHITE_REF, WHITE_NAME, 1_847), b: player(BLACK_REF, BLACK_NAME, 1_912) },
    you: { role: "player", color: "w" },
    drawOffer: null,
    canOfferAtPly: { w: 84, b: 0 },
    rematch: null,
    spectators: 12,
    result: null,
  };
}

/** One valid payload per command. */
export const COMMAND_FIXTURES: { [N in CommandName]: CommandPayload<N> } = {
  "game:join": { ref: GAME_REF, lastSeq: 186 },
  "spectate:join": { ref: GAME_REF },
  "game:leave": { ref: GAME_REF },
  "game:sync": { ref: GAME_REF },
  "study:ready": { ref: GAME_REF },
  "game:move": { ref: GAME_REF, ply: 123, uci: "e7e8q", clientMoveId: "m7k2x9q4w1z8p3r5", premove: true },
  "game:abort": { ref: GAME_REF },
  "game:resign": { ref: GAME_REF },
  "draw:offer": { ref: GAME_REF },
  "draw:accept": { ref: GAME_REF },
  "draw:decline": { ref: GAME_REF },
  "rematch:offer": { ref: GAME_REF },
  "rematch:accept": { ref: GAME_REF },
  "rematch:decline": { ref: GAME_REF },
  "rematch:cancel": { ref: GAME_REF },
  "clock:ping": { c: T0 + 1_234 },
  "live:list": { timeClass: "blitz" },
  "session:refresh_token": { token: "eyJ2IjoyfQ.c2lnbmF0dXJlLW9mLXRoZS10b2tlbi1zaXh0eS1mb3VyLWNoYXJz" },
};

/** One valid, worst-case-length payload per game event (3-digit seq and ply, epoch-ms times). */
export function eventFixtures(): { [N in GameEventName]: GameEventPayload<N> } {
  const base = { seq: 187, ref: GAME_REF } as const;
  return {
    "game:snapshot": gameStateFixture(),
    "game:phase": {
      ...base,
      phase: "first_move",
      firstMove: { side: "b", deadlineAt: T0 + 61_234 },
      clocks: { w: 300_000, b: 300_000, run: null, at: T0 + 31_234 },
    },
    "study:ready": { ...base, side: "b" },
    "move:applied": {
      ...base,
      ply: 123,
      uci: "e7e8q",
      san: "exd8=Q+",
      by: "b",
      clocks: CLOCKS,
      check: true,
      premove: true,
      drawOfferCleared: true,
    },
    "clock:sync": { ...base, clocks: CLOCKS, frozen: { since: T0 + 612_000, reason: "restart" } },
    "presence:update": { ...base, side: "b", online: false, graceEndsAt: T0 + 642_345 },
    "draw:offered": { ...base, by: "w" },
    "draw:declined": { ...base, by: "b", canOfferAtPly: 127, implicit: true },
    "draw:cancelled": { ...base },
    "game:ended": {
      ...base,
      winner: "w",
      method: "timeout_vs_insufficient",
      ply: 123,
      endedAt: T0 + 612_345,
      finalFen: GAME80_FEN,
      clocks: { w: 0, b: 291_802, run: null, at: T0 + 612_345 },
      rated: false,
    },
    "game:result": { ...base, ratings: null, tournament: null, review: { status: "none" } },
    "session:hello": { bootId: "b7Hq2xKp9LmZ4wRt", useq: 1_234, serverNow: T0 + 612_345 },
    "rematch:offered": { ...base, by: "w", expiresAt: T0 + 642_345, youPlay: "w" },
    "rematch:declined": { ...base, by: "b" },
    "rematch:cancelled": { ...base, by: "w" },
    "rematch:expired": { ...base, by: "w", reason: "timeout" },
    "rematch:started": { ...base, newRef: NEW_GAME_REF, colors: { w: BLACK_REF, b: WHITE_REF } },
    "spectators:update": { ref: GAME_REF, count: 1_234 },
    "game:error": { ref: GAME_REF, code: "internal", message: "Lost sync with the game server" },
    "server:restarting": { restartAt: T0 + 642_345, resumes: true },
  };
}
