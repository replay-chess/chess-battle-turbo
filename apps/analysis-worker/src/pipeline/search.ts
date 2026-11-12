// One position's engine facts (phase-03 plan §8.12 step 5): the eval cache first (E1 LRU → E2 SQLite, exact
// `(engine build, nodes, multipv)` keys, the Lichess seed only early in games from the initial position), then the
// engine, with the lag pause before every search. Scores come back relative to the side to move; everything stored
// or cached is White POV (`fromEngineScore`).
//
// Every engine search starts from a cleared engine (`ucinewgame`: hash, history and correction tables), so a position's
// facts depend only on (position, moves, budget, build) and never on what the process searched before. That makes a
// resumed run (a retry from a checkpoint, an engine restart mid-game) grade exactly like an uninterrupted one, and a
// cache hit exactly equal to a fresh search (plan §12.4 determinism rules, R19; the label-stability job). The clear
// costs a few milliseconds per search at Hash 64 (measured in WK/README.md "Determinism").
import { encodeMove, fromEngineScore, NO_SECOND } from "@repo/chess-analysis/codec";
import { cacheEligible, seedAllowed, type CachedLine, type EvalCache } from "../cache/evalcache";
import { EngineFailed, type EnginePool, type SearchResult } from "../engine";
import type { LagPause } from "../socket/load";
import type { PositionPlan } from "./positions";

export interface Budget {
  nodes: number;
  multipv: number;
}

/** One position's facts (White POV). */
export interface PositionEval {
  eval: number;
  /** MultiPV-2 score, or NO_SECOND. */
  second: number;
  /** MoveCode of the best move (0 = none). */
  best: number;
  bestUci: string | null;
  depth: number;
  /** Every MultiPV line: its eval (White POV) and PV (UCI). */
  lines: CachedLine[];
  source: "engine" | "memory" | "disk" | "terminal";
}

export interface SearchStats {
  searches: number;
  nodes: number;
  engineMs: number;
  hitsMemory: number;
  hitsDisk: number;
  lagPauseMs: number;
  /** Depth of every pass-1 position that was searched or cached (the median is `depthP50`). */
  depths: number[];
}

export interface SearcherOptions {
  engine: EnginePool;
  cache: EvalCache | null;
  lag: LagPause | null;
  signal: AbortSignal;
  /** The game started from the initial position (the seed rule). */
  fromInitial: boolean;
}

export function emptyStats(): SearchStats {
  return { searches: 0, nodes: 0, engineMs: 0, hitsMemory: 0, hitsDisk: 0, lagPauseMs: 0, depths: [] };
}

/** Converts an engine result for a position whose side to move is `pos.mover`. */
export function factsFromSearch(pos: Pick<PositionPlan, "mover">, result: SearchResult): Omit<PositionEval, "source"> {
  const lines = [...result.lines].sort((a, b) => a.multipv - b.multipv);
  const first = lines[0];
  if (!first) throw new EngineFailed("the engine returned no line for a position with legal moves");
  const evalOf = (l: (typeof lines)[number]) => fromEngineScore(l.score, pos.mover);
  const second = lines[1] ? evalOf(lines[1]) : NO_SECOND;
  const bestUci = result.bestmove ?? first.pv[0] ?? null;
  return {
    eval: evalOf(first),
    second,
    best: bestUci ? encodeMove(bestUci) : 0,
    bestUci,
    depth: first.depth,
    lines: lines.map((l) => ({ eval: evalOf(l), pv: l.pv })),
  };
}

export class Searcher {
  readonly stats: SearchStats = emptyStats();

  constructor(private readonly opts: SearcherOptions) {}

  /**
   * The facts of one position at `budget`. `pass1` records the depth for `depthP50`. `allowCache` is false for
   * positions the rules exclude (repetition, half-move clock ≥ 90, EVAL_CACHE=off is `cache: null`).
   */
  async evaluate(pos: PositionPlan, budget: Budget, opts: { pass1: boolean }): Promise<PositionEval> {
    if (pos.terminal !== null) {
      return { eval: pos.terminal, second: NO_SECOND, best: 0, bestUci: null, depth: 0, lines: [], source: "terminal" };
    }
    const cache = this.opts.cache;
    const eligible = cacheEligible({
      enabled: cache !== null,
      seenEarlier: pos.seenEarlier,
      halfmoveClock: pos.halfmoveClock,
    });
    const key = { epd: pos.epd, engine: this.opts.engine.buildId, nodes: budget.nodes, multipv: budget.multipv };
    if (cache && eligible) {
      const hit = cache.get(key, {
        allowSeed: opts.pass1 && seedAllowed({ fromInitialPosition: this.opts.fromInitial, ply: pos.index }),
      });
      if (hit) {
        if (hit.tier === "memory") this.stats.hitsMemory++;
        else this.stats.hitsDisk++;
        if (opts.pass1) this.stats.depths.push(hit.depth);
        const bestUci = hit.best;
        return {
          eval: hit.eval,
          second: hit.second,
          best: bestUci ? encodeMove(bestUci) : 0,
          bestUci,
          depth: hit.depth,
          lines: hit.lines ?? [{ eval: hit.eval, pv: bestUci ? [bestUci] : [] }],
          source: hit.tier,
        };
      }
    }
    if (this.opts.lag) this.stats.lagPauseMs += await this.opts.lag.waitForCapacity(this.opts.signal);
    await this.opts.engine.newGame();
    const result = await this.opts.engine.search({
      fen: pos.searchFen,
      moves: pos.searchMoves,
      nodes: budget.nodes,
      multipv: budget.multipv,
    });
    this.stats.searches++;
    this.stats.nodes += result.nodes;
    this.stats.engineMs += result.ms;
    const facts = factsFromSearch(pos, result);
    if (opts.pass1) this.stats.depths.push(facts.depth);
    if (cache && eligible) {
      cache.put(key, {
        eval: facts.eval,
        second: facts.second,
        best: facts.bestUci,
        depth: facts.depth,
        lines: facts.lines,
      });
    }
    return { ...facts, source: "engine" };
  }

  /** Total cache hits over every lookup that could have hit (searches + hits). */
  cacheHitRatio(): number {
    const hits = this.stats.hitsMemory + this.stats.hitsDisk;
    const total = hits + this.stats.searches;
    return total === 0 ? 0 : hits / total;
  }
}

/** The median of the recorded depths (`game_analyses."depthP50"`), or null. */
export function medianDepth(depths: readonly number[]): number | null {
  if (depths.length === 0) return null;
  const sorted = [...depths].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
