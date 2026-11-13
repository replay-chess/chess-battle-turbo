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
import type { EngineInitInfo, EngineProgress, EngineSearch, EngineSearchResult } from "@/features/engine/uci";
import { lineCp } from "@/features/engine/score";
import type { SharedEngine } from "@/features/engine/EngineProvider";

/** The slice of the shared engine the bot needs (a fake in unit tests). */
export type BotEngineHost = Pick<SharedEngine, "init" | "search" | "newGame" | "retain" | "retry" | "status" | "subscribeProgress">;

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
  /** The engine files' download progress while they load (null when none is in flight); returns the unsubscribe. */
  onLoading(listener: (progress: EngineProgress | null) => void): () => void;
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
    onLoading: (listener) => host().subscribeProgress(listener),
  };
}

/**
 * The tab's shared engine behind a dynamic import, so the engine glue (EngineProvider, the UCI session, the shim
 * manifest) stays a lazy chunk while the bot screen itself is part of /game/[ref]'s first load (it is server-rendered
 * in the document's shell; GameScreen.tsx). Calls made before the chunk is in run in order once it is: each is chained
 * on the same load promise. The synchronous ones (`retain`, `subscribeProgress`) hand back a release that also works
 * before the load finished.
 */
export function lazyEngineHost(load: () => Promise<SharedEngine> = loadSharedEngine): BotEngineHost {
  let engine: SharedEngine | null = null;
  let pending: Promise<SharedEngine> | null = null;
  const ready = () =>
    (pending ??= load().then((e) => {
      engine = e;
      return e;
    }));
  /** Runs `attach` once the engine is in; the returned release undoes it (or stops it from running at all). */
  const deferred = (attach: (e: SharedEngine) => () => void) => {
    let release: (() => void) | null = null;
    let done = false;
    void ready().then((e) => {
      if (!done) release = attach(e);
    });
    return () => {
      done = true;
      release?.();
      release = null;
    };
  };
  return {
    init: () => ready().then((e) => e.init()),
    search: (job) => ready().then((e) => e.search(job)),
    newGame: () => {
      void ready().then((e) => e.newGame());
    },
    retain: () => deferred((e) => e.retain()),
    retry: () => ready().then((e) => e.retry()),
    status: () => engine?.status() ?? "idle",
    subscribeProgress: (listener) => deferred((e) => e.subscribeProgress(listener)),
  };
}

const loadSharedEngine = () => import("@/features/engine/EngineProvider").then((m) => m.getEngine());

/** One per tab, like the engine it fronts. Creating it imports and starts nothing (safe in the server render). */
const tabEngine = lazyEngineHost();

/** The bot engine over the tab's shared worker (nothing loads or starts until `ready()` or a search). */
export function useBotEngine(): BotEngine {
  return createBotEngine(() => tabEngine);
}
