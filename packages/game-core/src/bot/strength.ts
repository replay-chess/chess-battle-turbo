// Bot strength ladder (plan 8.13; uncalibrated in P2, calibrated in P9, handoff H-06). Nodes, not depth or time,
// so strength is the same on a phone and a desktop; the engine provider stops a search after 3 s on slow devices.
// The low rungs add a weakening layer driven by a seeded PRNG (mulberry32(hash(ref) + ply)), so a reload replays
// the same choice.

import { Chess } from "chess.js";
import { applyUci, toUci } from "../rules/chess";

export interface LadderRow {
  /** Shown strength ("vs Engine 1400"). */
  elo: number;
  limitStrength: boolean;
  uciElo: number | null;
  skill: number | null;
  nodes: number;
  multiPv: number;
  weaken: { altPct: number; maxLossCp: number; randomPct: number } | null;
}

export const LADDER: readonly LadderRow[] = [
  {
    elo: 400,
    limitStrength: false,
    uciElo: null,
    skill: 0,
    nodes: 400,
    multiPv: 4,
    weaken: { altPct: 0.35, maxLossCp: 300, randomPct: 0.1 },
  },
  {
    elo: 600,
    limitStrength: false,
    uciElo: null,
    skill: 1,
    nodes: 800,
    multiPv: 4,
    weaken: { altPct: 0.28, maxLossCp: 250, randomPct: 0.07 },
  },
  {
    elo: 800,
    limitStrength: false,
    uciElo: null,
    skill: 2,
    nodes: 1500,
    multiPv: 4,
    weaken: { altPct: 0.2, maxLossCp: 200, randomPct: 0.05 },
  },
  {
    elo: 1000,
    limitStrength: false,
    uciElo: null,
    skill: 3,
    nodes: 3000,
    multiPv: 3,
    weaken: { altPct: 0.15, maxLossCp: 150, randomPct: 0.03 },
  },
  {
    elo: 1200,
    limitStrength: false,
    uciElo: null,
    skill: 5,
    nodes: 6000,
    multiPv: 3,
    weaken: { altPct: 0.1, maxLossCp: 120, randomPct: 0 },
  },
  { elo: 1400, limitStrength: true, uciElo: 1400, skill: null, nodes: 20_000, multiPv: 1, weaken: null },
  { elo: 1600, limitStrength: true, uciElo: 1600, skill: null, nodes: 40_000, multiPv: 1, weaken: null },
  { elo: 1800, limitStrength: true, uciElo: 1800, skill: null, nodes: 70_000, multiPv: 1, weaken: null },
  { elo: 2000, limitStrength: true, uciElo: 2000, skill: null, nodes: 120_000, multiPv: 1, weaken: null },
  { elo: 2200, limitStrength: true, uciElo: 2200, skill: null, nodes: 250_000, multiPv: 1, weaken: null },
];

export const MIN_BOT_ELO = 400;
export const MAX_BOT_ELO = 2200;
export const FALLBACK_BOT_ELO = 1200;

/** Fallback when the engine's UCI_Elo floor is above a limit-strength rung (Stockfish 16+ clamps to 1320). */
export const FLOOR_FALLBACK = { skill: 7, nodes: 12_000 } as const;

/** Legacy difficulty selector (useBotMove.ts:20-23). */
export const LEGACY_DIFFICULTY_ELO = { easy: 800, medium: 1400, hard: 1800, expert: 2200 } as const;

/** The rung for a requested Elo: the nearest row, ties to the lower one. */
export function ladderRow(elo: number): LadderRow {
  let best = LADDER[0]!;
  for (const row of LADDER) if (Math.abs(row.elo - elo) < Math.abs(best.elo - elo)) best = row;
  return best;
}

/** Default when the create body omits botElo: the viewer's rating rounded to 100 and clamped, else 1200. */
export function defaultBotElo(rating: number | null | undefined): number {
  if (rating == null || !Number.isFinite(rating)) return FALLBACK_BOT_ELO;
  return Math.min(MAX_BOT_ELO, Math.max(MIN_BOT_ELO, Math.round(rating / 100) * 100));
}

/** `UCI_Elo` minimum from the engine's `uci` output, or null if the option is missing. */
export function parseEloFloor(uciOutput: string): number | null {
  const m = /option name UCI_Elo type spin(?: default -?\d+)? min (-?\d+)/.exec(uciOutput);
  return m ? Number(m[1]) : null;
}

export interface EngineSetup {
  /** `setoption name <k> value <v>` pairs, in order. */
  options: [string, string][];
  /** The `go` command. */
  go: string;
  multiPv: number;
  weaken: LadderRow["weaken"];
  /** True when the rung fell back to Skill Level because of the UCI_Elo floor. */
  floorFallback: boolean;
}

export function engineSetup(row: LadderRow, eloFloor: number | null): EngineSetup {
  if (row.limitStrength && row.uciElo !== null) {
    if (eloFloor !== null && row.uciElo < eloFloor) {
      return {
        options: [
          ["UCI_LimitStrength", "false"],
          ["Skill Level", String(FLOOR_FALLBACK.skill)],
          ["MultiPV", "1"],
        ],
        go: `go nodes ${FLOOR_FALLBACK.nodes}`,
        multiPv: 1,
        weaken: null,
        floorFallback: true,
      };
    }
    return {
      options: [
        ["UCI_LimitStrength", "true"],
        ["UCI_Elo", String(row.uciElo)],
        ["MultiPV", "1"],
      ],
      go: `go nodes ${row.nodes}`,
      multiPv: 1,
      weaken: null,
      floorFallback: false,
    };
  }
  return {
    options: [
      ["UCI_LimitStrength", "false"],
      ["Skill Level", String(row.skill ?? 20)],
      ["MultiPV", String(row.multiPv)],
    ],
    go: `go nodes ${row.nodes}`,
    multiPv: row.multiPv,
    weaken: row.weaken,
    floorFallback: false,
  };
}

/** 32-bit FNV-1a. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PvLine {
  uci: string;
  /** Centipawns from the bot's point of view. */
  cp?: number;
  /** Mate in N from the bot's point of view (negative: the bot gets mated). */
  mate?: number;
}

/** A large score for mates so they compare with centipawns. */
export function lineScore(l: PvLine): number {
  if (l.mate !== undefined) return l.mate > 0 ? 100_000 - l.mate : -100_000 - l.mate;
  return l.cp ?? 0;
}

/** True when playing `uci` in `fen` lets the opponent mate in one. */
export function allowsMateInOne(fen: string, uci: string): boolean {
  const c = new Chess(fen);
  if (!applyUci(c, uci)) return true;
  for (const reply of c.moves({ verbose: true })) {
    c.move(reply);
    const mate = c.isCheckmate();
    c.undo();
    if (mate) return true;
  }
  return false;
}

/**
 * Picks the bot's move (plan 8.13). Limit-strength rungs and any position where the bot has a forced mate play the
 * engine's best line. Otherwise the seeded PRNG decides: `randomPct` → a random legal move, `altPct` → a uniform pick
 * among PV 2–4 losing less than `maxLossCp`; else the best line. A weakened pick never lets the human mate in one.
 */
export function chooseBotMove(opts: {
  ref: string;
  ply: number;
  fen: string;
  row: LadderRow | EngineSetup;
  lines: readonly PvLine[];
}): string {
  const best = opts.lines[0];
  if (!best) {
    const legal = new Chess(opts.fen).moves({ verbose: true });
    return legal.length ? toUci(legal[0]!) : "";
  }
  const weaken = opts.row.weaken;
  if (!weaken || (best.mate !== undefined && best.mate > 0)) return best.uci;
  const rng = mulberry32((hashString(opts.ref) + opts.ply) >>> 0);
  const r = rng();
  const safe = (uci: string) => !allowsMateInOne(opts.fen, uci);
  if (r < weaken.randomPct) {
    const legal = new Chess(opts.fen)
      .moves({ verbose: true })
      .map((m) => toUci(m))
      .filter(safe);
    if (legal.length) return legal[Math.floor(rng() * legal.length)]!;
    return best.uci;
  }
  if (r < weaken.randomPct + weaken.altPct) {
    const bestScore = lineScore(best);
    const alts = opts.lines.slice(1, 4).filter((l) => bestScore - lineScore(l) < weaken.maxLossCp && safe(l.uci));
    if (alts.length) return alts[Math.floor(rng() * alts.length)]!.uci;
  }
  return best.uci;
}

/** "≈1400 · strength not yet calibrated" until P9 calibrates the ladder. */
export const UNCALIBRATED_NOTE = "strength not yet calibrated";
