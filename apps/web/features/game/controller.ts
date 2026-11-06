// The game controller (P2 plan 5.2.6): one interface shared by the live (socket), local (bot, WP-H) and demo
// controllers. The screen never talks to a socket or an engine directly; it reads the per-game store through
// `deriveViewState` (features/game/viewState.ts) and calls these methods.
//
// Contract for implementers (WP-H's useLocalGame, the demo controller):
// - `store` is created with `createGameStore()` (features/game/store.ts) and is the only state the screen reads.
//   Feed it with `store.dispatch({ type: "replace", state, reason: "local", now })` and the other ClientActions of
//   `@repo/game-core/client/reducer`; local UI state (selection, promotion, resign popover, history view, toasts)
//   is dispatched by the screen itself through `store.dispatch`, so a controller only handles game commands.
// - `serverNow()` is the clock base the screen renders clocks and countdowns with: the socket server's epoch for
//   live games (offset-corrected), `Date.now()` for local and demo games.
// - Methods never throw; a refused command shows up as a store toast or a state change.
// - `destroy()` releases timers, socket holds and listeners; the screen calls it on unmount.

import type { GameState } from "@repo/game-core/machine/types";
import type { BoardMove } from "@/components/board/types";
import { createGameStore, type GameStore } from "./store";

export type ControllerKind = "live" | "local" | "demo";

export interface GameController {
  kind: ControllerKind;
  store: GameStore;
  /** Epoch ms on the authority's clock (socket server for live games). */
  serverNow(): number;
  /** A validated board move (promotion already chosen). */
  move(m: BoardMove): void;
  /** Queue a premove on the opponent's turn (live only); null cancels it. */
  setPremove(m: BoardMove | null): void;
  /** `study:ready`. */
  ready(): void;
  abort(): void;
  resign(): void;
  offerDraw(): void;
  answerDraw(accept: boolean): void;
  offerRematch(): void;
  answerRematch(accept: boolean): void;
  cancelRematch(): void;
  /** Bot games only (WP-H). */
  hint?(): void;
  undo?(): void;
  restart?(): void;
  /** "Reload game": `game:sync` (live), a journal reload (local). */
  sync(): void;
  destroy(): void;
}

/** Props every controller hook receives from GameScreen. */
export interface ControllerInit {
  /** Server-time of the RSC snapshot render (`snapshot.serverNow`) is the initial clock base. */
  now?: number;
}

/**
 * A controller that renders a state and ignores game commands (`kind: "demo"`). The demo route builds on it, and
 * BotGameScreen uses it until WP-H's local controller lands. UI-only actions (selection, history, toasts) still work
 * because the screen dispatches them to the store directly.
 */
export function createInertController(state: GameState, opts: { bot?: boolean; now?: number } = {}): GameController {
  const store = createGameStore(state, { joined: true, conn: "live", bot: opts.bot ?? state.mode === "BOT", now: opts.now ?? Date.now() });
  const noop = () => {};
  return {
    kind: "demo",
    store,
    serverNow: () => Date.now(),
    move: noop,
    setPremove: noop,
    ready: noop,
    abort: noop,
    resign: () => store.dispatch({ type: "resign", open: false }),
    offerDraw: noop,
    answerDraw: noop,
    offerRematch: noop,
    answerRematch: noop,
    cancelRematch: noop,
    sync: noop,
    destroy: noop,
  };
}
