// Design fixtures for the dev-DB content seed (SPEC §11.2).
//
// Six legends and five legend positions shown on the v3 design boards
// (Play hub "Legendary positions", Home "Start here", the command palette).
// The data is copied exactly from SPEC §11.2: do not add facts here.
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
  pgn: string | null;
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

export const OPERA_GAME_PGN =
  "1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5";

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
    pgn: null,
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
    pgn: null,
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
    pgn: null,
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
    pgn: null,
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
