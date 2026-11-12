// Design fixtures for the dev-DB content seed (SPEC §11.2).
//
// Six legends and five legend positions shown on the v3 design boards
// (Play hub "Legendary positions", Home "Start here", the command palette).
// The data is copied exactly from SPEC §11.2: do not add facts here. The legend game scores (P3, plan §8.9) are
// the historical games' published moves.
// Pure data: no Prisma client import, so unit tests run without `prisma generate`.

export type FixtureSide = "white" | "black";

export interface FixtureLegend {
  name: string;
  era: string;
  nationality: string;
  birthYear: number;
  deathYear: number | null;
  peakRating: number | null;
  playingStyle: string;
  /** `legends.shortDescription` is VarChar(500). */
  shortDescription: string;
  achievements: string[];
}

export interface FixturePosition {
  key: "mo" | "kt" | "bf" | "ak" | "ts";
  /** Legend name (FK) or, when `whiteIsLegend` is false, a plain player name. */
  white: string;
  whiteIsLegend: boolean;
  black: string;
  blackIsLegend: boolean;
  tournamentName: string;
  year: number;
  sideToMove: FixtureSide;
  theme: "Attack" | "Sacrifice" | "Endgame";
  fen: string;
  /** The legend game's score with its result (P3: the comparison needs the line past the position). */
  pgn: string;
}

export const DESIGN_FIXTURE_SOURCE_TYPE = "design-fixture";

export const FIXTURE_LEGENDS: readonly FixtureLegend[] = [
  {
    name: "Paul Morphy",
    era: "Romantic Era",
    nationality: "USA",
    birthYear: 1837,
    deathYear: 1884,
    peakRating: null,
    playingStyle: "Fast development and open lines",
    shortDescription:
      "American prodigy who beat Europe's leading players in 1858 and showed how quickly development wins.",
    achievements: ["Won the First American Chess Congress, 1857"],
  },
  {
    name: "Adolf Anderssen",
    era: "Romantic Era",
    nationality: "GER",
    birthYear: 1818,
    deathYear: 1879,
    peakRating: null,
    playingStyle: "Sacrificial attack",
    shortDescription:
      "German master who won London 1851, the first international tournament, and played the Immortal Game.",
    achievements: ["Won London 1851"],
  },
  {
    name: "Bobby Fischer",
    era: "Modern Era",
    nationality: "USA",
    birthYear: 1943,
    deathYear: 2008,
    peakRating: 2785,
    playingStyle: "Precise, classical and relentless",
    shortDescription: "11th World Champion (1972-1975), who played the Game of the Century at 13.",
    achievements: ["World Champion 1972-1975", "U.S. Champion eight times"],
  },
  {
    name: "Garry Kasparov",
    era: "Modern Era",
    nationality: "RUS",
    birthYear: 1963,
    deathYear: null,
    peakRating: 2851,
    playingStyle: "Dynamic, deeply prepared attacking play",
    shortDescription: "13th World Champion (1985-2000) and world number one for most of two decades.",
    achievements: ["World Champion 1985-2000"],
  },
  {
    name: "Veselin Topalov",
    era: "Modern Era",
    nationality: "BUL",
    birthYear: 1975,
    deathYear: null,
    peakRating: 2816,
    playingStyle: "Aggressive, initiative-first",
    shortDescription: "FIDE World Champion in 2005, known for sharp, uncompromising play.",
    achievements: ["FIDE World Champion 2005"],
  },
  {
    name: "Alexei Shirov",
    era: "Modern Era",
    nationality: "ESP",
    birthYear: 1972,
    deathYear: null,
    peakRating: null,
    playingStyle: "Tactical and imaginative",
    shortDescription:
      "Riga-born grandmaster famed for daring sacrifices, including 47...Bh3 against Topalov in 1998.",
    achievements: ["FIDE World Championship finalist, 2000"],
  },
];

// The legend games' scores (historical, public domain), each with its result, so a game played from the position can
// be compared with the legend's continuation (phase-03 plan §8.9: the line must continue past the position). Opera and
// Kasparov–Topalov equal @repo/chess-analysis/fixtures/legend/{opera,kt}.json `legendPgn`; Topalov–Shirov is given
// from the position (SetUp/FEN), the others from move 1. design-legend-positions.test.ts replays each one through
// its position and to its recorded end.
export const OPERA_GAME_PGN =
  "[Event \"Paris\"]\n[Site \"Paris FRA\"]\n[Date \"1858.??.??\"]\n[White \"Paul Morphy\"]\n[Black \"Duke Karl / Count Isouard\"]\n[Result \"1-0\"]\n\n1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0";

export const KASPAROV_TOPALOV_PGN =
  "[Event \"Hoogovens\"]\n[Site \"Wijk aan Zee NED\"]\n[Date \"1999.01.20\"]\n[White \"Garry Kasparov\"]\n[Black \"Veselin Topalov\"]\n[Result \"1-0\"]\n\n1.e4 d6 2.d4 Nf6 3.Nc3 g6 4.Be3 Bg7 5.Qd2 c6 6.f3 b5 7.Nge2 Nbd7 8.Bh6 Bxh6 9.Qxh6 Bb7 10.a3 e5 11.O-O-O Qe7 12.Kb1 a6 13.Nc1 O-O-O 14.Nb3 exd4 15.Rxd4 c5 16.Rd1 Nb6 17.g3 Kb8 18.Na5 Ba8 19.Bh3 d5 20.Qf4+ Ka7 21.Rhe1 d4 22.Nd5 Nbxd5 23.exd5 Qd6 24.Rxd4 cxd4 25.Re7+ Kb6 26.Qxd4+ Kxa5 27.b4+ Ka4 28.Qc3 Qxd5 29.Ra7 Bb7 30.Rxb7 Qc4 31.Qxf6 Kxa3 32.Qxa6+ Kxb4 33.c3+ Kxc3 34.Qa1+ Kd2 35.Qb2+ Kd1 36.Bf1 Rd2 37.Rd7 Rxd7 38.Bxc4 bxc4 39.Qxh8 Rd3 40.Qa8 c3 41.Qa4+ Ke1 42.f4 f5 43.Kc1 Rd2 44.Qa7 1-0";

export const BYRNE_FISCHER_PGN =
  "[Event \"Rosenwald Memorial\"]\n[Site \"New York, NY USA\"]\n[Date \"1956.10.17\"]\n[White \"Donald Byrne\"]\n[Black \"Bobby Fischer\"]\n[Result \"0-1\"]\n\n1.Nf3 Nf6 2.c4 g6 3.Nc3 Bg7 4.d4 O-O 5.Bf4 d5 6.Qb3 dxc4 7.Qxc4 c6 8.e4 Nbd7 9.Rd1 Nb6 10.Qc5 Bg4 11.Bg5 Na4 12.Qa3 Nxc3 13.bxc3 Nxe4 14.Bxe7 Qb6 15.Bc4 Nxc3 16.Bc5 Rfe8+ 17.Kf1 Be6 18.Bxb6 Bxc4+ 19.Kg1 Ne2+ 20.Kf1 Nxd4+ 21.Kg1 Ne2+ 22.Kf1 Nc3+ 23.Kg1 axb6 24.Qb4 Ra4 25.Qxb6 Nxd1 26.h3 Rxa2 27.Kh2 Nxf2 28.Re1 Rxe1 29.Qd8+ Bf8 30.Nxe1 Bd5 31.Nf3 Ne4 32.Qb8 b5 33.h4 h5 34.Ne5 Kg7 35.Kg1 Bc5+ 36.Kf1 Ng3+ 37.Ke1 Bb4+ 38.Kd1 Bb3+ 39.Kc1 Ne2+ 40.Kb1 Nc3+ 41.Kc1 Rc2# 0-1";

export const ANDERSSEN_KIESERITZKY_PGN =
  "[Event \"London\"]\n[Site \"London ENG\"]\n[Date \"1851.06.21\"]\n[White \"Adolf Anderssen\"]\n[Black \"Lionel Kieseritzky\"]\n[Result \"1-0\"]\n\n1.e4 e5 2.f4 exf4 3.Bc4 Qh4+ 4.Kf1 b5 5.Bxb5 Nf6 6.Nf3 Qh6 7.d3 Nh5 8.Nh4 Qg5 9.Nf5 c6 10.g4 Nf6 11.Rg1 cxb5 12.h4 Qg6 13.h5 Qg5 14.Qf3 Ng8 15.Bxf4 Qf6 16.Nc3 Bc5 17.Nd5 Qxb2 18.Bd6 Bxg1 19.e5 Qxa1+ 20.Ke2 Na6 21.Nxg7+ Kd8 22.Qf6+ Nxf6 23.Be7# 1-0";

export const TOPALOV_SHIROV_PGN =
  "[Event \"Linares\"]\n[Site \"Linares ESP\"]\n[Date \"1998.03.04\"]\n[White \"Veselin Topalov\"]\n[Black \"Alexei Shirov\"]\n[Result \"0-1\"]\n[SetUp \"1\"]\n[FEN \"8/8/4kpp1/3p1b2/p6P/2B5/6P1/6K1 b - - 0 47\"]\n\n47...Bh3 48.gxh3 Kf5 49.Kf2 Ke4 50.Bxf6 d4 51.Be7 Kd3 52.Bc5 Kc4 53.Be7 Kb3 0-1";

export const FIXTURE_POSITIONS: readonly FixturePosition[] = [
  {
    key: "mo",
    white: "Paul Morphy",
    whiteIsLegend: true,
    black: "Duke Karl of Brunswick and Count Isouard",
    blackIsLegend: false,
    tournamentName: "Paris Opera",
    year: 1858,
    sideToMove: "white",
    theme: "Attack",
    fen: "rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10",
    pgn: OPERA_GAME_PGN,
  },
  {
    key: "kt",
    white: "Garry Kasparov",
    whiteIsLegend: true,
    black: "Veselin Topalov",
    blackIsLegend: true,
    tournamentName: "Wijk aan Zee",
    year: 1999,
    sideToMove: "white",
    theme: "Sacrifice",
    fen: "b2r3r/k4p1p/p2q1np1/NppP4/3p1Q2/P4PPB/1PP4P/1K1RR3 w - - 1 24",
    pgn: KASPAROV_TOPALOV_PGN,
  },
  {
    key: "bf",
    white: "Donald Byrne",
    whiteIsLegend: false,
    black: "Bobby Fischer",
    blackIsLegend: true,
    tournamentName: "Rosenwald Memorial, New York",
    year: 1956,
    sideToMove: "black",
    theme: "Sacrifice",
    fen: "r3r1k1/pp3pbp/1qp3p1/2B5/2BP2b1/Q1n2N2/P4PPP/3R1K1R b - - 3 17",
    pgn: BYRNE_FISCHER_PGN,
  },
  {
    key: "ak",
    white: "Adolf Anderssen",
    whiteIsLegend: true,
    black: "Lionel Kieseritzky",
    blackIsLegend: false,
    tournamentName: "London",
    year: 1851,
    sideToMove: "white",
    theme: "Attack",
    fen: "rnb1k1nr/p2p1ppp/8/1pbN1N1P/4PBP1/3P1Q2/PqP5/R4KR1 w kq - 0 18",
    pgn: ANDERSSEN_KIESERITZKY_PGN,
  },
  {
    key: "ts",
    white: "Veselin Topalov",
    whiteIsLegend: true,
    black: "Alexei Shirov",
    blackIsLegend: true,
    tournamentName: "Linares",
    year: 1998,
    sideToMove: "black",
    theme: "Endgame",
    fen: "8/8/4kpp1/3p1b2/p6P/2B5/6P1/6K1 b - - 0 47",
    pgn: TOPALOV_SHIROV_PGN,
  },
];

/** The FEN's full-move field (6th field). */
export function moveNumberFromFen(fen: string): number {
  const n = Number(fen.trim().split(/\s+/)[5]);
  if (!Number.isInteger(n) || n < 1) throw new Error(`bad full-move number in FEN: ${fen}`);
  return n;
}

/** The FEN's side-to-move field, in the `prisma/seed.ts` "white"/"black" convention. */
export function sideToMoveFromFen(fen: string): FixtureSide {
  const s = fen.trim().split(/\s+/)[1];
  if (s === "w") return "white";
  if (s === "b") return "black";
  throw new Error(`bad side-to-move field in FEN: ${fen}`);
}

/** `famousGames` title, built only from the table's own columns. */
export function fixtureGameTitle(p: FixturePosition): string {
  return `${p.white} vs ${p.black}, ${p.tournamentName} ${p.year}`;
}

/** `legends.famousGames` for one legend: the fixture positions they play in, `[{ title, year, fen }]`. */
export function famousGamesFor(legendName: string): { title: string; year: number; fen: string }[] {
  return FIXTURE_POSITIONS.filter(
    (p) => (p.whiteIsLegend && p.white === legendName) || (p.blackIsLegend && p.black === legendName),
  ).map((p) => ({ title: fixtureGameTitle(p), year: p.year, fen: p.fen }));
}
