"use client";

// The bot's use of the browser engine (phase-02 plan 8.13–8.15): the reply search for the strength ladder rung
// (options + `go nodes N`, 3 s stop cap, the seeded weakening layer), the full-strength hint search
// (`go movetime 300`) and the quick draw evaluation (`go nodes 20000`). Each search sends its own options, so a
// hint never leaves the engine at full strength for the next reply.

import { BOT_STOP_AFTER_MS } from "@repo/game-core/constants";
import { chooseBotMove, engineSetup, FALLBACK_BOT_ELO, ladderRow, type PvLine } from "@repo/game-core/bot/strength";
import { HINT_SEARCH } from "@repo/game-core/bot/hints";
import { DRAW_EVAL_GO } from "@repo/game-core/local/drawPolicy";
import { splitMoves } from "@repo/game-core/rules/chess";
import type { GameState } from "@repo/game-core/machine/types";
import type { EngineInitInfo, EngineSearch, EngineSearchResult } from "@/features/engine/uci";
import { lineCp } from "@/features/engine/uci";
import { getEngine, type SharedEngine } from "@/features/engine/EngineProvider";

/** The slice of the shared engine the bot needs (a fake in unit tests). */
export type BotEngineHost = Pick<SharedEngine, "init" | "search" | "newGame" | "retain" | "retry" | "status">;

export interface BotEngine {
  /** Starts the worker (prefetches the WASM); resolves with the floor and the source. */
  ready(): Promise<EngineInitInfo>;
  /** The bot's move, or null when the search was cancelled. */
  reply(state: Pick<GameState, "ref" | "startFen" | "moves" | "fen" | "startPly">, elo: number, signal?: AbortSignal): Promise<string | null>;
  /** The best move at full strength (hints), or null when cancelled. */
  best(state: Pick<GameState, "startFen" | "moves">, signal?: AbortSignal): Promise<string | null>;
  /** Centipawns for the side to move after a quick search, or null when cancelled / no score. */
  evaluate(state: Pick<GameState, "startFen" | "moves">, signal?: AbortSignal): Promise<number | null>;
  newGame(): void;
  retain(): () => void;
  retry(): Promise<EngineInitInfo>;
}

const FULL_STRENGTH: readonly (readonly [string, string])[] = [
  ["UCI_LimitStrength", "false"],
  ["Skill Level", "20"],
  ["MultiPV", "1"],
];

function job(state: Pick<GameState, "startFen" | "moves">, rest: Omit<EngineSearch, "startFen" | "moves">): EngineSearch {
  return { startFen: state.startFen, moves: splitMoves(state.moves), ...rest };
}

const toPv = (r: EngineSearchResult): PvLine[] =>
  r.lines.map((l) => {
    const pv: PvLine = { uci: l.uci };
    if (l.cp !== undefined) pv.cp = l.cp;
    if (l.mate !== undefined) pv.mate = l.mate;
    return pv;
  });

export function createBotEngine(host: () => BotEngineHost): BotEngine {
  return {
    ready: () => host().init(),
    async reply(state, elo, signal) {
      const engine = host();
      const info = await engine.init();
      const setup = engineSetup(ladderRow(Number.isFinite(elo) ? elo : FALLBACK_BOT_ELO), info.eloFloor);
      const r = await engine.search(
        job(state, { options: setup.options, go: setup.go, multiPv: setup.multiPv, stopAfterMs: BOT_STOP_AFTER_MS, signal }),
      );
      if (r.cancelled) return null;
      const plies = splitMoves(state.moves).length;
      const move = chooseBotMove({ ref: state.ref, ply: state.startPly + plies, fen: state.fen, row: setup, lines: toPv(r) });
      return move || r.best || null;
    },
    async best(state, signal) {
      const r = await host().search(job(state, { options: HINT_SEARCH.options, go: HINT_SEARCH.go, multiPv: 1, signal }));
      if (r.cancelled) return null;
      return r.best || r.lines[0]?.uci || null;
    },
    async evaluate(state, signal) {
      const r = await host().search(job(state, { options: FULL_STRENGTH, go: DRAW_EVAL_GO, multiPv: 1, signal }));
      if (r.cancelled || !r.lines[0]) return null;
      return lineCp(r.lines[0]);
    },
    newGame: () => host().newGame(),
    retain: () => host().retain(),
    retry: () => host().retry(),
  };
}

/** The bot engine over the tab's shared worker (nothing starts until `ready()` or a search). */
export function useBotEngine(): BotEngine {
  // A plain object over a lazy getter: safe to create during the server render (no worker there).
  return createBotEngine(getEngine);
}
