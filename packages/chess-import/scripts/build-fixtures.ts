/**
 * Builds the import fixtures (phase-04 plan §12.5) into `@repo/chess-fixtures/import/`:
 *
 *   chesscom/knightowl_88/{profile,stats,archives}.json
 *   chesscom/knightowl_88/2026-08.json, 2026-09.json, 2026-10.json   (+ *.expected.json beside each)
 *   lichess/knightowl88/{account.json, games.ndjson, games.expected.json}
 *
 * Sources, all reproducible from the repo:
 *   - `import/source/cc0-pool.json`: 75 rated standard games from the Lichess export (CC0), reduced to moves, clocks,
 *     evals, status and opening; no ids, names, ratings or dates. Re-create it from a raw export with
 *     `--make-pool <export.ndjson>` (one polite anonymous request, `pgnInJson=false`).
 *   - constructed games: Sam Loyd's ten-move stalemate, the threefold-by-transposition line of P2's rule fixtures,
 *     a Black-to-move setup, and seeded random play (deterministic) for the insufficient-material, fifty-move,
 *     time-vs-insufficient and under-promotion endings that real short games rarely reach.
 *
 * Expected values come from chess.js directly (the SAN played here), not from the mappers under test.
 *
 *   pnpm --filter @repo/chess-import exec tsx scripts/build-fixtures.ts [--out <dir>] [--make-pool <raw.ndjson>]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import { encodeChessComGame, encodeLichessGame, type LichessEvalSpec } from "../src/testing/encode";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX_IMPORT = path.resolve(HERE, "../../chess-fixtures/import");
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/* ------------------------------------------------------------------------------------------------------------ */
/* Pool                                                                                                         */
/* ------------------------------------------------------------------------------------------------------------ */

type PoolGame = {
  speed: string;
  status: string;
  winner?: "white" | "black";
  moves: string;
  clocks?: number[];
  analysis?: LichessEvalSpec[];
  opening?: { eco: string; name: string; ply: number };
  clock?: { initial: number; increment: number };
  daysPerTurn?: number;
};

function makePool(rawPath: string, outPath: string): void {
  const games: PoolGame[] = [];
  for (const line of readFileSync(rawPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const g = JSON.parse(line) as Record<string, unknown> & PoolGame & { variant: string; rated: boolean };
    if (g.variant !== "standard" || g.rated !== true) continue;
    const p: PoolGame = { speed: g.speed, status: g.status, moves: g.moves.trim() };
    if (g.winner) p.winner = g.winner;
    if (g.clocks) p.clocks = g.clocks;
    if (g.analysis) p.analysis = g.analysis.map((a) => ("mate" in a ? { mate: a.mate } : { eval: (a as { eval: number }).eval }));
    if (g.opening) p.opening = g.opening;
    if (g.clock) p.clock = { initial: g.clock.initial, increment: g.clock.increment };
    if (g.daysPerTurn !== undefined) p.daysPerTurn = g.daysPerTurn;
    games.push(p);
  }
  writeFileSync(
    outPath,
    `${JSON.stringify({ $comment: "Rated standard Lichess games (CC0), reduced to moves, clocks, evals, status and opening. Built by packages/chess-import/scripts/build-fixtures.ts --make-pool.", games }, null, 0)}\n`,
  );
  console.log(`pool: ${games.length} games → ${outPath}`);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Helpers                                                                                                      */
/* ------------------------------------------------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function play(startFen: string, sans: readonly string[]): Chess {
  const c = new Chess(startFen);
  for (const s of sans) c.move(s);
  return c;
}

/** Non-king material of one side, as piece letters. */
function material(c: Chess, side: "w" | "b"): string[] {
  const out: string[] = [];
  for (const row of c.board()) for (const sq of row) if (sq && sq.color === side && sq.type !== "k") out.push(sq.type);
  return out;
}
const cannotMate = (m: string[]) => m.length === 0 || (m.length === 1 && (m[0] === "n" || m[0] === "b"));

/**
 * Seeded random play from `startFen` until `stop(chess)` holds. Returns the SAN list, or null when the game ends
 * some other way first (or runs past `maxPlies`). `captureBias` prefers captures to thin the material.
 */
function randomGame(
  seed: number,
  stop: (c: Chess, last: { promotion?: string } | null) => boolean,
  opts: { startFen?: string; captureBias?: number; maxPlies?: number; underpromote?: boolean } = {},
): string[] | null {
  const rnd = mulberry32(seed);
  const c = new Chess(opts.startFen ?? START);
  const sans: string[] = [];
  let last: { promotion?: string } | null = null;
  for (let i = 0; i < (opts.maxPlies ?? 900); i++) {
    if (stop(c, last)) return sans;
    if (c.isGameOver()) return null;
    let moves = c.moves({ verbose: true });
    if (!opts.underpromote) moves = moves.filter((m) => !m.promotion || m.promotion === "q");
    const captures = moves.filter((m) => m.captured);
    const pool = captures.length && rnd() < (opts.captureBias ?? 0) ? captures : moves;
    const mv = pool[Math.floor(rnd() * pool.length)]!;
    const done = c.move(mv.san);
    sans.push(done.san);
    last = { promotion: done.promotion };
  }
  return null;
}

function firstSeed(label: string, f: (seed: number) => string[] | null): string[] {
  for (let seed = 1; seed < 5000; seed++) {
    const r = f(seed);
    if (r) {
      console.log(`  ${label}: seed ${seed}, ${r.length} plies`);
      return r;
    }
  }
  throw new Error(`no seed found for ${label}`);
}

/** Per-ply clocks (ms) for a constructed game: each side starts at `base` and spends 1–9 s per move. */
function syntheticClocks(n: number, baseMs: number, incMs: number, rnd: () => number): number[] {
  const left = { w: baseMs, b: baseMs };
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? "w" : "b";
    left[side] = Math.max(100, left[side] - Math.round((1 + rnd() * 8) * 1000) - (rnd() < 0.3 ? 37 : 0) + incMs);
    out.push(left[side]);
  }
  return out;
}

function scaleClocks(clocksCs: readonly number[] | undefined, plies: number, srcInitialSec: number, dstBaseSec: number): number[] | undefined {
  if (!clocksCs || clocksCs.length < plies || srcInitialSec <= 0) return undefined;
  const k = dstBaseSec / srcInitialSec;
  // Chess.com %clk carries tenths: round to 100 ms.
  return clocksCs.slice(0, plies).map((cs) => Math.max(0, Math.round((cs * 10 * k) / 100) * 100));
}

const slug = (name: string) =>
  name
    .replace(/[:,'’()]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const write = (rel: string, data: unknown, ndjson = false) => {
  const file = path.join(OUT, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, ndjson ? (data as string) : `${JSON.stringify(data, null, 2)}\n`);
};

/* ------------------------------------------------------------------------------------------------------------ */
/* Arguments                                                                                                    */
/* ------------------------------------------------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const OUT = path.resolve(arg("--out") ?? FX_IMPORT);
const POOL_PATH = path.join(OUT, "source/cc0-pool.json");
const rawPool = arg("--make-pool");
if (rawPool) {
  mkdirSync(path.dirname(POOL_PATH), { recursive: true });
  makePool(rawPool, POOL_PATH);
}
const POOL = (JSON.parse(readFileSync(POOL_PATH, "utf8")) as { games: PoolGame[] }).games;
const used = new Set<number>();
function take(pred: (g: PoolGame, c: Chess) => boolean, label: string): PoolGame {
  for (let i = 0; i < POOL.length; i++) {
    if (used.has(i)) continue;
    const g = POOL[i]!;
    if (pred(g, play(START, g.moves.split(" ")))) {
      used.add(i);
      return g;
    }
  }
  throw new Error(`pool has no game for ${label}`);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Constructed lines                                                                                            */
/* ------------------------------------------------------------------------------------------------------------ */

console.log("constructed lines:");
const LOYD_STALEMATE = "e3 a5 Qh5 Ra6 Qxa5 h5 h4 Rah6 Qxc7 f6 Qxd7+ Kf7 Qxb7 Qd3 Qxb8 Qh7 Qxc8 Kg6 Qe6".split(" ");
const THREEFOLD = "Nf3 Nf6 Nc3 Nc6 Nb1 Nb8 Ng1 Ng8 Nc3 Nc6 Nf3 Nf6 Ng1 Ng8 Nb1 Nb8".split(" ");
const BLACK_TO_MOVE_FEN = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 10";
const BLACK_TO_MOVE = ["Nf6", "Nc3", "Bc5", "Bc4", "O-O", "O-O", "d6", "d3", "Bg4", "h3", "Bxf3", "Qxf3", "Nd4", "Qd1"];
const INSUFFICIENT = firstSeed("insufficient material", (s) =>
  randomGame(s, (c) => c.isInsufficientMaterial(), { captureBias: 0.85 }),
);
const FIFTY = firstSeed("fifty-move", (s) =>
  randomGame(s, (c) => c.isDrawByFiftyMoves() && !c.isInsufficientMaterial() && !c.isThreefoldRepetition(), {
    captureBias: 0.6,
  }),
);
const TIME_VS_INSUFFICIENT = firstSeed("time vs insufficient", (s) =>
  randomGame(
    s,
    (c) => cannotMate(material(c, "b")) && !cannotMate(material(c, "w")) && c.turn() === "w" && !c.isGameOver(),
    { captureBias: 0.8 },
  ),
);
const UNDERPROMOTION = firstSeed("under-promotion", (s) =>
  randomGame(s, (c, last) => !!last?.promotion && last.promotion !== "q" && !c.isGameOver(), {
    captureBias: 0.7,
    underpromote: true,
  }),
);
const assertEnd = (sans: string[], startFen: string, check: (c: Chess) => boolean, label: string) => {
  if (!check(play(startFen, sans))) throw new Error(`constructed ${label} does not end as intended`);
};
assertEnd(LOYD_STALEMATE, START, (c) => c.isStalemate(), "stalemate");
assertEnd(THREEFOLD, START, (c) => c.isThreefoldRepetition(), "threefold");
assertEnd(BLACK_TO_MOVE, BLACK_TO_MOVE_FEN, (c) => !c.isGameOver(), "black-to-move");
// The chess960 game (skipped by rules): a real Chess960 start, plain moves chess.js can replay.
const CHESS960_FEN = "bqnrkrnb/pppppppp/8/8/8/8/PPPPPPPP/BQNRKRNB w - - 0 1";
const CHESS960 = ["e4", "e5", "Nf3", "Nf6", "Nd3", "Nd6"];
play(CHESS960_FEN, CHESS960);

/* ------------------------------------------------------------------------------------------------------------ */
/* Chess.com: knightowl_88                                                                                      */
/* ------------------------------------------------------------------------------------------------------------ */

const ME_CC = "KnightOwl_88";
type CcExpected =
  | {
      externalId: string;
      colour: "w" | "b";
      outcome: string;
      endMethod: string;
      plyCount: number;
      fen: string;
      timeClass: string;
      clocksLength: number;
      startPly: number;
      endedAt: string;
      case?: string;
    }
  | { externalId: string; skip: string; case: string };

type CcCase = {
  sans: string[];
  startFen?: string;
  /** Chess.com code of the side that did not win; "win" never appears here. For draws, both sides carry it. */
  code: string;
  winner: "white" | "black" | null;
  memberColour: "w" | "b";
  timeClass: "bullet" | "blitz" | "rapid" | "daily";
  timeControl: string;
  clocksMs?: number[];
  opening?: { eco: string; name: string };
  rated?: boolean;
  rules?: string;
  fenMismatch?: boolean;
  /** Fixed end time (unix s); otherwise spread over the month. */
  endTime?: number;
  label?: string;
};

const DRAW_END: Record<string, string> = {
  agreed: "AGREEMENT",
  repetition: "THREEFOLD",
  stalemate: "STALEMATE",
  insufficient: "INSUFFICIENT_MATERIAL",
  "50move": "FIFTY_MOVE",
  timevsinsufficient: "TIMEOUT_VS_INSUFFICIENT",
};
const LOSS_END: Record<string, string> = {
  checkmated: "CHECKMATE",
  resigned: "RESIGNATION",
  timeout: "TIMEOUT",
  abandoned: "ABANDONED",
};

const TC_BASE: Record<string, number> = { "600": 600, "900+10": 900, "180+2": 180, "300": 300, "60": 60, "120+1": 120 };
const rndCc = mulberry32(88);
const ccRating = (tc: string) => (tc === "rapid" ? 1184 : tc === "blitz" ? 1032 : tc === "bullet" ? 871 : 1100);

function poolCase(g: PoolGame, i: number, code: string, timeClass: CcCase["timeClass"], timeControl: string): CcCase {
  const sans = g.moves.split(" ");
  const winner = g.winner ?? null;
  const base = timeClass === "daily" ? 0 : TC_BASE[timeControl]!;
  return {
    sans,
    code,
    winner,
    memberColour: i % 2 === 0 ? "w" : "b",
    timeClass,
    timeControl,
    clocksMs: timeClass === "daily" ? undefined : scaleClocks(g.clocks, sans.length, g.clock?.initial ?? 0, base),
    opening: g.opening ? { eco: g.opening.eco, name: g.opening.name } : undefined,
  };
}

const lossCode = (g: PoolGame) =>
  g.status === "mate" ? "checkmated" : g.status === "outoftime" ? "timeout" : g.status === "timeout" ? "abandoned" : "resigned";

const months: Record<string, CcCase[]> = { "2026-08": [], "2026-09": [], "2026-10": [] };

// Real games (pool), by ending.
const mates = [0, 1, 2].map(() => take((g, c) => g.status === "mate" && c.isCheckmate(), "mate"));
const flags = [0, 1, 2, 3].map(() =>
  take((g) => g.status === "outoftime" && !!g.winner && g.speed !== "correspondence", "timeout"),
);
const abandons = [0, 1].map(() => take((g) => g.status === "timeout" && !!g.winner, "abandoned"));
const repetition = take((g, c) => g.status === "draw" && c.isThreefoldRepetition(), "repetition");
const agreed = take((g, c) => g.status === "draw" && !c.isThreefoldRepetition() && !c.isDrawByFiftyMoves(), "agreed");
const enPassant = take((g, c) => c.history({ verbose: true }).some((m) => m.isEnPassant()) && !!g.winner, "en passant");
const bothCastles = take(
  (g, c) => {
    const h = c.history({ verbose: true });
    return !!g.winner && h.some((m) => m.isKingsideCastle()) && h.some((m) => m.isQueensideCastle());
  },
  "both castlings",
);
const resigns = Array.from({ length: 25 }, () => take((g) => g.status === "resign" && !!g.winner, "resign"));

const tcPlan: [CcCase["timeClass"], string][] = [
  ["rapid", "600"],
  ["rapid", "900+10"],
  ["blitz", "180+2"],
  ["rapid", "600"],
  ["bullet", "60"],
  ["blitz", "300"],
  ["rapid", "600"],
  ["bullet", "120+1"],
];
let k = 0;
const real: CcCase[] = [];
for (const g of [...mates, ...flags, ...abandons, enPassant, bothCastles, ...resigns]) {
  const [tc, ctl] = tcPlan[k % tcPlan.length]!;
  real.push({ ...poolCase(g, k, lossCode(g), tc, ctl), label: g === enPassant ? "en passant" : g === bothCastles ? "O-O and O-O-O" : undefined });
  k++;
}
real.push({ ...poolCase(repetition, k++, "repetition", "rapid", "600"), winner: null });
real.push({ ...poolCase(agreed, k++, "agreed", "blitz", "180+2"), winner: null });

// Constructed endings.
const constructed: CcCase[] = [
  { sans: LOYD_STALEMATE, code: "stalemate", winner: null, memberColour: "b", timeClass: "rapid", timeControl: "600", label: "stalemate (Loyd)" },
  { sans: INSUFFICIENT, code: "insufficient", winner: null, memberColour: "w", timeClass: "blitz", timeControl: "300", label: "insufficient material" },
  { sans: FIFTY, code: "50move", winner: null, memberColour: "b", timeClass: "rapid", timeControl: "900+10", label: "fifty-move rule" },
  { sans: TIME_VS_INSUFFICIENT, code: "timevsinsufficient", winner: null, memberColour: "w", timeClass: "bullet", timeControl: "60", label: "timeout vs insufficient" },
  { sans: UNDERPROMOTION, code: "resigned", winner: UNDERPROMOTION.length % 2 === 1 ? "white" : "black", memberColour: "w", timeClass: "rapid", timeControl: "600", label: "under-promotion" },
  { sans: BLACK_TO_MOVE, startFen: BLACK_TO_MOVE_FEN, code: "resigned", winner: "black", memberColour: "b", timeClass: "daily", timeControl: "1/86400", label: "custom initial_setup, Black to move" },
  {
    sans: mates[0]!.moves.split(" ").slice(0, 30),
    code: "resigned",
    winner: "white",
    memberColour: "w",
    timeClass: "daily",
    timeControl: "1/86400",
    endTime: Date.UTC(2026, 9, 14, 23, 30, 0) / 1000,
    label: "daily, ends 23:30 UTC (next local day in Asia/Kolkata)",
  },
  { sans: CHESS960, startFen: CHESS960_FEN, code: "resigned", winner: "white", memberColour: "w", timeClass: "blitz", timeControl: "180+2", rules: "chess960", label: "chess960 (skipped)" },
  { ...poolCase(resigns[0]!, 1, "resigned", "rapid", "600"), rated: false, label: "unrated (skipped)" },
  { ...poolCase(resigns[1]!, 2, "resigned", "rapid", "600"), fenMismatch: true, label: "archive fen disagrees with the PGN (parse_error)" },
];

// 48 games: 14 / 16 / 18 per month.
const all = [...real, ...constructed];
if (all.length !== 48) throw new Error(`expected 48 Chess.com games, built ${all.length}`);
const order = all.map((c, i) => ({ c, key: (i * 37) % all.length }));
order.sort((a, b) => a.key - b.key);
const sizes: [string, number][] = [
  ["2026-08", 14],
  ["2026-09", 16],
  ["2026-10", 18],
];
let cursor = 0;
for (const [m, n] of sizes) {
  for (const { c } of order.slice(cursor, cursor + n)) months[m]!.push(c);
  cursor += n;
}
// The 23:30 UTC daily case belongs to October (its fixed end time).
for (const [m, list] of Object.entries(months)) {
  const i = list.findIndex((c) => c.endTime !== undefined);
  if (i >= 0 && m !== "2026-10") {
    const moved = list.splice(i, 1)[0]!;
    const back = months["2026-10"]!.findIndex((c) => c.endTime === undefined);
    list.splice(i, 0, months["2026-10"]!.splice(back, 1, moved)[0]!);
  }
}

let gameId = 140_000_000_000;
let dailyId = 1_030_000_000;
let opp = 0;
const ccStatsCount: Record<string, number> = {};
for (const [m, list] of Object.entries(months)) {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const monthStart = Date.UTC(y, mo - 1, 1) / 1000;
  const step = Math.floor((28 * 86400) / (list.length + 1));
  const games: Record<string, unknown>[] = [];
  const expected: CcExpected[] = [];
  list.forEach((c, i) => {
    const endTime = c.endTime ?? monthStart + step * (i + 1) + Math.floor(rndCc() * 3600);
    const daily = c.timeClass === "daily";
    const id = daily ? ++dailyId : (gameId += 1 + Math.floor(rndCc() * 997));
    opp++;
    const oppName = `opponent_${String(opp).padStart(2, "0")}`;
    const myRating = ccRating(c.timeClass) + Math.round((rndCc() - 0.5) * 60);
    const theirRating = myRating + Math.round((rndCc() - 0.5) * 200);
    const draw = c.winner === null;
    const whiteIsMe = c.memberColour === "w";
    const resultOf = (side: "white" | "black") => (draw ? c.code : c.winner === side ? "win" : c.code);
    const white = { username: whiteIsMe ? ME_CC : oppName, rating: whiteIsMe ? myRating : theirRating, result: resultOf("white") };
    const black = { username: whiteIsMe ? oppName : ME_CC, rating: whiteIsMe ? theirRating : myRating, result: resultOf("black") };
    const startFen = c.startFen ?? START;
    const board = play(startFen, c.sans);
    let fenOverride: string | undefined;
    if (c.fenMismatch) fenOverride = play(startFen, c.sans.slice(0, -1)).fen();
    const clocksMs =
      c.clocksMs ?? (daily ? undefined : syntheticClocks(c.sans.length, (TC_BASE[c.timeControl] ?? 600) * 1000, 0, rndCc));
    const dailyClocks = daily ? syntheticClocks(c.sans.length, 86_400_000, 0, rndCc) : undefined;
    games.push(
      encodeChessComGame({
        id,
        kind: daily ? "daily" : "live",
        startFen: c.startFen,
        sans: c.sans,
        white,
        black,
        timeClass: c.timeClass,
        timeControl: c.timeControl,
        endTime,
        startTime: daily ? endTime - 6 * 86400 : endTime - 900,
        rated: c.rated ?? true,
        rules: c.rules,
        clocksMs: clocksMs ?? dailyClocks,
        eco: c.opening?.eco,
        ecoUrl: c.opening ? `https://www.chess.com/openings/${slug(c.opening.name)}` : undefined,
        fenOverride,
        termination: draw ? "Game drawn" : `${c.winner === "white" ? white.username : black.username} won`,
      }),
    );
    const externalId = String(id);
    if (c.rules && c.rules !== "chess") expected.push({ externalId, skip: "variant", case: c.label ?? "variant" });
    else if (c.rated === false) expected.push({ externalId, skip: "unrated", case: c.label ?? "unrated" });
    else if (c.fenMismatch) expected.push({ externalId, skip: "parse_error", case: c.label ?? "fen mismatch" });
    else {
      ccStatsCount[c.timeClass] = (ccStatsCount[c.timeClass] ?? 0) + 1;
      const e: CcExpected = {
        externalId,
        colour: c.memberColour,
        outcome: draw ? "DRAW" : c.winner === "white" ? "WHITE" : "BLACK",
        endMethod: draw ? DRAW_END[c.code]! : LOSS_END[c.code]!,
        plyCount: c.sans.length,
        fen: board.fen(),
        timeClass: c.timeClass.toUpperCase(),
        clocksLength: (clocksMs ?? dailyClocks)?.length ?? 0,
        startPly: 2 * (Number(startFen.split(" ")[5]) - 1) + (startFen.split(" ")[1] === "b" ? 1 : 0),
        endedAt: new Date(endTime * 1000).toISOString(),
      };
      if (c.label) e.case = c.label;
      expected.push(e);
    }
  });
  // Archive months list games by end time, oldest first.
  const idx = games.map((g, i) => i).sort((a, b) => (games[a]!.end_time as number) - (games[b]!.end_time as number));
  write(`chesscom/knightowl_88/${m}.json`, { games: idx.map((i) => games[i]) });
  write(`chesscom/knightowl_88/${m}.expected.json`, {
    $comment: "Per game, in archive order: what @repo/chess-import's mapper must produce (or the skip reason). Built by scripts/build-fixtures.ts from chess.js, not from the mapper.",
    member: "knightowl_88",
    games: idx.map((i) => expected[i]),
  });
}
console.log("chess.com imported per class:", ccStatsCount);

write("chesscom/knightowl_88/profile.json", {
  avatar: "https://images.chesscomfiles.com/uploads/v1/user/0.0.jpeg",
  player_id: 41_000_088,
  "@id": "https://api.chess.com/pub/player/knightowl_88",
  url: "https://www.chess.com/member/KnightOwl_88",
  name: "Knight Owl",
  username: "knightowl_88",
  followers: 12,
  country: "https://api.chess.com/pub/country/IN",
  location: "Pune",
  last_online: Date.UTC(2026, 10, 1) / 1000,
  joined: Date.UTC(2021, 2, 14) / 1000,
  status: "basic",
  is_streamer: false,
  verified: false,
  league: "Wood",
  streaming_platforms: [],
});
write("chesscom/knightowl_88/stats.json", {
  chess_rapid: {
    last: { rating: 1184, date: Date.UTC(2026, 9, 30) / 1000, rd: 45 },
    best: { rating: 1231, date: Date.UTC(2026, 4, 2) / 1000, game: "https://www.chess.com/game/live/139000000001" },
    record: { win: 160, loss: 141, draw: 19 },
  },
  chess_blitz: {
    last: { rating: 1032, date: Date.UTC(2026, 9, 28) / 1000, rd: 61 },
    best: { rating: 1090, date: Date.UTC(2026, 1, 11) / 1000, game: "https://www.chess.com/game/live/138000000001" },
    record: { win: 52, loss: 49, draw: 4 },
  },
  chess_bullet: {
    last: { rating: 871, date: Date.UTC(2026, 9, 21) / 1000, rd: 88 },
    best: { rating: 902, date: Date.UTC(2026, 6, 3) / 1000, game: "https://www.chess.com/game/live/137000000001" },
    record: { win: 26, loss: 28, draw: 1 },
  },
  fide: 0,
  tactics: { highest: { rating: 1420, date: Date.UTC(2026, 3, 1) / 1000 }, lowest: { rating: 600, date: Date.UTC(2021, 2, 14) / 1000 } },
  puzzle_rush: {},
});
write("chesscom/knightowl_88/archives.json", {
  archives: ["2026/08", "2026/09", "2026/10"].map((m) => `https://api.chess.com/pub/player/knightowl_88/games/${m}`),
});

/* ------------------------------------------------------------------------------------------------------------ */
/* Lichess: knightowl88                                                                                         */
/* ------------------------------------------------------------------------------------------------------------ */

type LiCase = {
  sans: string[];
  startFen?: string;
  status: string;
  winner?: "white" | "black";
  memberColour: "w" | "b";
  speed: string;
  clock?: { initial: number; increment: number };
  daysPerTurn?: number;
  clocksCs?: number[];
  analysis?: LichessEvalSpec[];
  opening?: { eco: string; name: string; ply: number };
  oppTitle?: string;
  label?: string;
  rated?: boolean;
};

const rndLi = mulberry32(8_888);
const fromPool = (g: PoolGame, i: number, over: Partial<LiCase> = {}): LiCase => ({
  sans: g.moves.split(" "),
  status: g.status,
  winner: g.winner,
  memberColour: i % 2 === 0 ? "b" : "w",
  speed: g.speed,
  clock: g.clock,
  daysPerTurn: g.daysPerTurn,
  clocksCs: g.clocks,
  analysis: g.analysis,
  opening: g.opening,
  ...over,
});
const scaleCs = (cs: number[] | undefined, from: number, to: number) =>
  cs?.map((v) => Math.max(0, Math.round((v * to) / from)));

const liMates = [0, 1, 2].map(() => take((g, c) => g.status === "mate" && c.isCheckmate() && !!g.analysis, "lichess mate"));
const liResigns = Array.from({ length: 12 }, () => take((g) => g.status === "resign" && !!g.winner, "lichess resign"));
const liFlag = take((g) => g.status === "outoftime" && !!g.winner && g.speed !== "correspondence", "lichess outoftime");
const liAbandon = take((g) => g.status === "timeout" && !!g.winner, "lichess timeout");
const liDraw = take((g, c) => g.status === "draw" && c.isThreefoldRepetition(), "lichess threefold draw");
const liCorr = take((g) => g.speed === "correspondence", "lichess correspondence");
const liUnder = POOL.find((g) => g.analysis && play(START, g.moves.split(" ")).history({ verbose: true }).some((m) => m.promotion && m.promotion !== "q"));

let li = 0;
const liCases: LiCase[] = [
  ...liMates.map((g) => fromPool(g, li++, { label: "mate, analysis with mate scores" })),
  ...liResigns.map((g) => fromPool(g, li++)),
  fromPool(liFlag, li++),
  fromPool(liAbandon, li++, { label: "timeout (abandoned)" }),
  fromPool(liDraw, li++, { label: "draw upgraded to THREEFOLD by replay" }),
  fromPool(liCorr, li++, { label: "correspondence" }),
  fromPool(liResigns[0]!, li++, {
    speed: "ultraBullet",
    clock: { initial: 15, increment: 0 },
    clocksCs: scaleCs(liResigns[0]!.clocks, liResigns[0]!.clock?.initial ?? 300, 15),
    label: "ultraBullet",
  }),
  fromPool(liResigns[1]!, li++, {
    speed: "classical",
    clock: { initial: 1800, increment: 0 },
    clocksCs: scaleCs(liResigns[1]!.clocks, liResigns[1]!.clock?.initial ?? 300, 1800),
    label: "classical",
  }),
  fromPool(liResigns[2]!, li++, { oppTitle: "BOT", label: "BOT opponent" }),
  {
    sans: BLACK_TO_MOVE,
    startFen: BLACK_TO_MOVE_FEN,
    status: "resign",
    winner: "black",
    memberColour: "b",
    speed: "rapid",
    clock: { initial: 600, increment: 5 },
    label: "fromPosition, Black to move, odd startPly",
  },
  { sans: LOYD_STALEMATE, status: "stalemate", memberColour: "w", speed: "blitz", clock: { initial: 180, increment: 2 }, label: "stalemate" },
  { sans: FIFTY, status: "draw", memberColour: "b", speed: "rapid", clock: { initial: 900, increment: 10 }, label: "draw upgraded to FIFTY_MOVE by replay" },
  { sans: TIME_VS_INSUFFICIENT, status: "outoftime", memberColour: "b", speed: "bullet", clock: { initial: 60, increment: 0 }, label: "outoftime without winner" },
  { sans: THREEFOLD, status: "draw", memberColour: "w", speed: "blitz", clock: { initial: 300, increment: 0 }, label: "threefold by transposition" },
  { sans: ["e4"], status: "aborted", memberColour: "w", speed: "blitz", clock: { initial: 300, increment: 0 }, label: "aborted (skipped)" },
];
if (liUnder) liCases.push(fromPool(liUnder, li++, { label: "under-promotion, analysis" }));
while (liCases.length < 30) liCases.push(fromPool(take((g) => g.status === "resign" && !!g.winner, "lichess filler"), li++));
if (liCases.length !== 30) throw new Error(`expected 30 Lichess games, built ${liCases.length}`);

const liLines: string[] = [];
const liExpected: unknown[] = [];
const liEnd = (c: LiCase, board: Chess): string => {
  switch (c.status) {
    case "mate":
      return "CHECKMATE";
    case "resign":
      return "RESIGNATION";
    case "stalemate":
      return "STALEMATE";
    case "outoftime":
      return c.winner ? "TIMEOUT" : "TIMEOUT_VS_INSUFFICIENT";
    case "timeout":
      return "ABANDONED";
    case "draw":
      return board.isThreefoldRepetition() ? "THREEFOLD" : board.isDrawByFiftyMoves() ? "FIFTY_MOVE" : "AGREEMENT";
    default:
      return "OTHER";
  }
};
const SPEED_TC: Record<string, string> = {
  ultraBullet: "BULLET",
  bullet: "BULLET",
  blitz: "BLITZ",
  rapid: "RAPID",
  classical: "CLASSICAL",
  correspondence: "DAILY",
};
// Newest first, like the export: the first line ends 2026-10-30, then about every 3 days back.
let t = Date.UTC(2026, 9, 30, 20, 0, 0);
liCases.forEach((c, i) => {
  const id = `Kn${String(i).padStart(2, "0")}${Math.floor(rndLi() * 1e4).toString(36).padStart(4, "0")}`.slice(0, 8);
  const lastMoveAt = t;
  const createdAt = c.speed === "correspondence" ? t - 9 * 86_400_000 : t - Math.round((5 + rndLi() * 20) * 60_000);
  t -= Math.round((2 + rndLi() * 2) * 86_400_000);
  const me = { id: "knightowl88", name: "KnightOwl88", rating: 1480 + Math.round(rndLi() * 80), ratingDiff: 0 };
  const them = {
    id: c.oppTitle === "BOT" ? "maia-bot-5" : `opponent${String(i + 1).padStart(2, "0")}`,
    name: c.oppTitle === "BOT" ? "Maia-Bot-5" : `Opponent${String(i + 1).padStart(2, "0")}`,
    title: c.oppTitle,
    rating: me.rating + Math.round((rndLi() - 0.5) * 200),
    ratingDiff: 0,
  };
  const myWin = c.winner ? (c.winner === "white") === (c.memberColour === "w") : null;
  me.ratingDiff = c.status === "aborted" ? 0 : myWin === null ? 0 : myWin ? 6 : -6;
  them.ratingDiff = -me.ratingDiff;
  const white = c.memberColour === "w" ? me : them;
  const black = c.memberColour === "w" ? them : me;
  const clocksCs =
    c.clocksCs ??
    (c.clock ? syntheticClocks(c.sans.length, c.clock.initial * 1000, c.clock.increment * 1000, rndLi).map((ms) => Math.round(ms / 10)) : undefined);
  const game = encodeLichessGame({
    id,
    startFen: c.startFen,
    sans: c.sans,
    speed: c.speed,
    status: c.status,
    winner: c.winner,
    white,
    black,
    createdAt,
    lastMoveAt,
    clock: c.clock,
    daysPerTurn: c.daysPerTurn,
    clocksCs: c.speed === "correspondence" ? undefined : clocksCs,
    analysis: c.analysis,
    opening: c.opening,
    source: c.speed === "correspondence" ? "friend" : "pool",
  });
  liLines.push(JSON.stringify(game));
  const startFen = c.startFen ?? START;
  const board = play(startFen, c.sans);
  if (c.status === "aborted") liExpected.push({ externalId: id, skip: "aborted", case: c.label });
  else {
    const plies = c.sans.length;
    const clocksLength = c.speed !== "correspondence" && clocksCs && clocksCs.length >= plies ? plies : 0;
    const a = c.analysis;
    const evalHintLength = a && (a.length === plies || (board.isCheckmate() && a.length === plies - 1)) ? plies : 0;
    liExpected.push({
      externalId: id,
      colour: c.memberColour,
      outcome: c.winner === "white" ? "WHITE" : c.winner === "black" ? "BLACK" : "DRAW",
      endMethod: liEnd(c, board),
      plyCount: plies,
      fen: board.fen(),
      timeClass: SPEED_TC[c.speed],
      clocksLength,
      startPly: 2 * (Number(startFen.split(" ")[5]) - 1) + (startFen.split(" ")[1] === "b" ? 1 : 0),
      endedAt: new Date(lastMoveAt).toISOString(),
      evalHintLength,
      ratingDelta: me.ratingDiff,
      ...(c.oppTitle ? { opponentTitle: c.oppTitle } : {}),
      ...(c.label ? { case: c.label } : {}),
    });
  }
});
// One malformed line (a truncated record) after the 7th game: skipped and counted, never fatal.
liLines.splice(7, 0, '{"id":"Broken01","rated":true,"variant":"standard","speed":"blit');
write("lichess/knightowl88/games.ndjson", `${liLines.join("\n")}\n`, true);
write("lichess/knightowl88/games.expected.json", {
  $comment: "Per valid line, in stream order (newest first): what the Lichess mapper must produce (or the skip reason). One malformed line follows the 7th game. Built by scripts/build-fixtures.ts from chess.js, not from the mapper.",
  member: "knightowl88",
  invalidLines: 1,
  games: liExpected,
});
write("lichess/knightowl88/account.json", {
  id: "knightowl88",
  username: "KnightOwl88",
  perfs: {
    bullet: { games: 41, rating: 1388, rd: 75, prog: -12 },
    blitz: { games: 230, rating: 1512, rd: 52, prog: 18 },
    rapid: { games: 64, rating: 1561, rd: 66, prog: 9, prov: false },
    classical: { games: 3, rating: 1620, rd: 140, prog: 0, prov: true },
    correspondence: { games: 2, rating: 1700, rd: 160, prog: 0, prov: true },
    ultraBullet: { games: 5, rating: 1290, rd: 150, prog: 0, prov: true },
    puzzle: { games: 410, rating: 1650, rd: 70, prog: 21 },
  },
  createdAt: Date.UTC(2022, 0, 9),
  seenAt: Date.UTC(2026, 10, 1),
  playTime: { total: 512_000, tv: 0 },
  url: "https://lichess.org/@/KnightOwl88",
  count: { all: 345, rated: 340, ai: 0, draw: 12, drawH: 12, loss: 160, lossH: 160, win: 173, winH: 173, bookmark: 0, playing: 0, import: 0, me: 0 },
  followable: true,
  following: false,
  blocking: false,
});
console.log(`lichess: ${liCases.length} games + 1 malformed line; pool used ${used.size}/${POOL.length}`);
