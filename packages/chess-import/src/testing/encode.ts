// Provider-shaped game JSON from a move list (phase-04 plan §12.5): the fixture builder
// (`scripts/build-fixtures.ts`), the mapper tests and, later, the e2e upstream mock and the P4 persona seeds use it
// to produce Chess.com archive games and Lichess export lines that look exactly like the real ones (field names and
// order checked against live responses, 2026-11-12). Pure; chess.js computes the PGN, the final FEN and the UCI.
// Import it as `@repo/chess-import/testing/encode`; it is not part of the package barrel.
import { Chess } from "chess.js";
import { INITIAL_FEN } from "@repo/game-core/constants";

/* ------------------------------------------------------------------------------------------------------------ */
/* Chess.com                                                                                                    */
/* ------------------------------------------------------------------------------------------------------------ */

export interface ChessComSideSpec {
  username: string;
  rating: number;
  /** A Chess.com result code (`win`, `resigned`, `agreed`, …). */
  result: string;
}

export interface ChessComGameSpec {
  /** The numeric game id in the URL. */
  id: number;
  kind?: "live" | "daily";
  /** Omitted or the standard FEN: a standard start. */
  startFen?: string;
  /** SAN moves from `startFen`. */
  sans: readonly string[];
  white: ChessComSideSpec;
  black: ChessComSideSpec;
  timeClass: string;
  /** `"180+2"`, `"600"`, `"1/86400"`. */
  timeControl: string;
  /** Unix seconds. */
  endTime: number;
  startTime?: number;
  rated?: boolean;
  rules?: string;
  /** Remaining ms after each ply, one per ply (`%clk`); omitted → no clock comments. */
  clocksMs?: readonly number[];
  eco?: string;
  ecoUrl?: string;
  uuid?: string;
  accuracies?: { white: number; black: number };
  /** Replaces the archive `fen` (the "archive disagrees with the PGN" fixture case). */
  fenOverride?: string;
  /** Free-text termination for the PGN header. */
  termination?: string;
}

/** `%clk` text: `h:mm:ss` plus `.t` tenths when the value has them. */
export function formatClk(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  const base = `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return total % 1000 === 0 ? base : `${base}.${tenths}`;
}

const pgnDate = (unix: number) => {
  const d = new Date(unix * 1000);
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
};
const pgnTime = (unix: number) => new Date(unix * 1000).toISOString().slice(11, 19);

function pgnResult(white: string, black: string): string {
  if (white === "win") return "1-0";
  if (black === "win") return "0-1";
  return "1/2-1/2";
}

function replaySans(startFen: string, sans: readonly string[]): Chess {
  const chess = new Chess(startFen);
  for (const san of sans) chess.move(san);
  return chess;
}

/** Builds one Chess.com archive game (the `games[]` entry of `/pub/player/{u}/games/{YYYY}/{MM}`). */
export function encodeChessComGame(spec: ChessComGameSpec): Record<string, unknown> {
  const startFen = spec.startFen ?? INITIAL_FEN;
  const chess = replaySans(startFen, spec.sans);
  const history = chess.history({ verbose: true });
  const kind = spec.kind ?? (spec.timeClass === "daily" ? "daily" : "live");
  const url = `https://www.chess.com/game/${kind}/${spec.id}`;
  const result = pgnResult(spec.white.result, spec.black.result);
  const startTime = spec.startTime ?? spec.endTime - 600;
  const ecoUrl = spec.ecoUrl;
  const headers: [string, string][] = [
    ["Event", "Live Chess"],
    ["Site", "Chess.com"],
    ["Date", pgnDate(startTime)],
    ["Round", "-"],
    ["White", spec.white.username],
    ["Black", spec.black.username],
    ["Result", result],
  ];
  if (startFen !== INITIAL_FEN) headers.push(["SetUp", "1"], ["FEN", startFen]);
  headers.push(["CurrentPosition", spec.fenOverride ?? chess.fen()], ["Timezone", "UTC"]);
  if (spec.eco) headers.push(["ECO", spec.eco]);
  if (ecoUrl) headers.push(["ECOUrl", ecoUrl]);
  headers.push(
    ["UTCDate", pgnDate(startTime)],
    ["UTCTime", pgnTime(startTime)],
    ["WhiteElo", String(spec.white.rating)],
    ["BlackElo", String(spec.black.rating)],
    ["TimeControl", spec.timeControl],
    ["Termination", spec.termination ?? `${spec.white.username} vs ${spec.black.username}`],
    ["StartTime", pgnTime(startTime)],
    ["EndDate", pgnDate(spec.endTime)],
    ["EndTime", pgnTime(spec.endTime)],
    ["Link", url],
  );
  const startTurn = startFen.split(" ")[1] === "b" ? 1 : 0;
  const startMove = Number(startFen.split(" ")[5] ?? "1");
  const parts: string[] = [];
  history.forEach((mv, i) => {
    const ply = startTurn + i;
    const moveNo = startMove + Math.floor(ply / 2);
    const prefix = ply % 2 === 0 ? `${moveNo}.` : `${moveNo}...`;
    const clk = spec.clocksMs?.[i];
    parts.push(clk === undefined ? `${prefix} ${mv.san}` : `${prefix} ${mv.san} {[%clk ${formatClk(clk)}]}`);
  });
  const pgn = `${headers.map(([k, v]) => `[${k} "${v.replace(/"/g, '\\"')}"]`).join("\n")}\n\n${parts.join(" ")} ${result}\n`;

  const side = (s: ChessComSideSpec, n: number) => ({
    rating: s.rating,
    result: s.result,
    "@id": `https://api.chess.com/pub/player/${s.username.toLowerCase()}`,
    username: s.username,
    uuid: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  });
  const game: Record<string, unknown> = {
    url,
    pgn,
    time_control: spec.timeControl,
    end_time: spec.endTime,
    rated: spec.rated ?? true,
  };
  if (spec.accuracies) game.accuracies = spec.accuracies;
  game.uuid = spec.uuid ?? `00000000-0000-4000-9000-${String(spec.id).padStart(12, "0").slice(-12)}`;
  game.initial_setup = startFen;
  game.fen = spec.fenOverride ?? chess.fen();
  if (kind === "daily") game.start_time = startTime;
  game.time_class = spec.timeClass;
  game.rules = spec.rules ?? "chess";
  game.white = side(spec.white, spec.id * 2);
  game.black = side(spec.black, spec.id * 2 + 1);
  if (ecoUrl) game.eco = ecoUrl;
  return game;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Lichess                                                                                                      */
/* ------------------------------------------------------------------------------------------------------------ */

export interface LichessSideSpec {
  id: string;
  name: string;
  title?: string;
  rating: number;
  ratingDiff?: number;
  provisional?: boolean;
}

export type LichessEvalSpec = { eval: number } | { mate: number };

export interface LichessGameSpec {
  /** 8 characters, `[A-Za-z0-9]`. */
  id: string;
  /** Present → `variant: "fromPosition"` with this `initialFen`. */
  startFen?: string;
  sans: readonly string[];
  speed: string;
  status: string;
  winner?: "white" | "black";
  white: LichessSideSpec;
  black: LichessSideSpec;
  createdAt: number;
  lastMoveAt: number;
  rated?: boolean;
  variant?: string;
  /** Seconds. */
  clock?: { initial: number; increment: number };
  daysPerTurn?: number;
  /** Remaining centiseconds after each ply (Lichess `clocks`). */
  clocksCs?: readonly number[];
  analysis?: readonly LichessEvalSpec[];
  opening?: { eco: string; name: string; ply: number };
  source?: string;
}

/** Builds one line of `/api/games/user/{u}?…&pgnInJson=false&tags=false` (as an object; `JSON.stringify` it). */
export function encodeLichessGame(spec: LichessGameSpec): Record<string, unknown> {
  if (spec.startFen) replaySans(spec.startFen, spec.sans); // throws on an illegal fixture line
  else replaySans(INITIAL_FEN, spec.sans);
  const user = (s: LichessSideSpec) => {
    const u: Record<string, unknown> = { name: s.name };
    if (s.title) u.title = s.title;
    u.id = s.id;
    return u;
  };
  const player = (s: LichessSideSpec) => {
    const p: Record<string, unknown> = { user: user(s), rating: s.rating };
    if (s.ratingDiff !== undefined) p.ratingDiff = s.ratingDiff;
    if (s.provisional) p.provisional = true;
    return p;
  };
  const perf = spec.speed;
  const g: Record<string, unknown> = {
    id: spec.id,
    rated: spec.rated ?? true,
    variant: spec.variant ?? (spec.startFen ? "fromPosition" : "standard"),
    speed: spec.speed,
    perf,
    createdAt: spec.createdAt,
    lastMoveAt: spec.lastMoveAt,
    status: spec.status,
    source: spec.source ?? "pool",
    players: { white: player(spec.white), black: player(spec.black) },
  };
  if (spec.winner) g.winner = spec.winner;
  if (spec.startFen) g.initialFen = spec.startFen;
  if (spec.opening) g.opening = spec.opening;
  g.moves = spec.sans.join(" ");
  if (spec.clocksCs) g.clocks = [...spec.clocksCs];
  if (spec.analysis) g.analysis = spec.analysis.map((a) => ({ ...a }));
  if (spec.clock) g.clock = { ...spec.clock, totalTime: spec.clock.initial + 40 * spec.clock.increment };
  if (spec.daysPerTurn !== undefined) g.daysPerTurn = spec.daysPerTurn;
  return g;
}
