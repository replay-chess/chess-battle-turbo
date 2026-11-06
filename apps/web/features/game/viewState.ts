// View state for the screen (P2 plan 4.3): `deriveViewState(store, serverNow)` from @repo/game-core, computed once
// per store change plus a 1 s tick while something time-based can change the result (study_last5, low_time, the
// countdown kind). Clocks and countdown digits do NOT go through here: ClockChip and the countdown hooks read their
// own sources so a running clock never re-renders the screen.

import { deriveViewState, type ViewState } from "@repo/game-core/client/viewState";
import type { ClientGame } from "@repo/game-core/client/reducer";
import type { GameController } from "./controller";

export type { ViewState } from "@repo/game-core/client/viewState";

const TICK_MS = 1000;

function needsTick(g: ClientGame): boolean {
  const p = g.state.phase;
  if (p === "study" || p === "first_move" || p === "playing") return true;
  return p === "ended" && g.state.rematch !== null;
}

export interface ViewSource {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ViewState;
  /** Server render and hydration: derived at the snapshot's own `serverNow`, identical on both sides. */
  getServerSnapshot(): ViewState;
}

const sources = new WeakMap<GameController, ViewSource>();

/** One cached view-state source per controller (shared by every component of the screen). */
export function viewSourceFor(controller: GameController): ViewSource {
  const existing = sources.get(controller);
  if (existing) return existing;

  const { store } = controller;
  let cachedGame: ClientGame | null = null;
  let cachedTick = -1;
  let cached: ViewState | null = null;
  const initialGame = store.getState();
  let initialView: ViewState | null = null;
  let tick = 0;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let unsub: (() => void) | null = null;

  const notify = () => {
    for (const l of listeners) l();
  };
  const syncTimer = () => {
    const want = listeners.size > 0 && needsTick(store.getState());
    if (want && !timer) {
      timer = setInterval(() => {
        tick += 1;
        notify();
      }, TICK_MS);
    } else if (!want && timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const source: ViewSource = {
    getServerSnapshot: () => (initialView ??= deriveViewState(initialGame, initialGame.state.serverNow)),
    subscribe(listener) {
      listeners.add(listener);
      if (!unsub) {
        unsub = store.subscribe(() => {
          syncTimer();
          notify();
        });
      }
      syncTimer();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsub?.();
          unsub = null;
          syncTimer();
        }
      };
    },
    getSnapshot() {
      const g = store.getState();
      if (cached && g === cachedGame && tick === cachedTick) return cached;
      const next = deriveViewState(g, controller.serverNow());
      // Keep the identity when nothing visible changed on a tick (avoids a re-render per second).
      cached = cached && g === cachedGame && sameView(cached, next) ? cached : next;
      cachedGame = g;
      cachedTick = tick;
      return cached;
    },
  };
  sources.set(controller, source);
  return source;
}

function sameView(a: ViewState, b: ViewState): boolean {
  if (a.primary !== b.primary || a.zone !== b.zone || a.actions !== b.actions || a.bar !== b.bar) return false;
  if (a.modifiers.size !== b.modifiers.size) return false;
  for (const m of a.modifiers) if (!b.modifiers.has(m)) return false;
  if (a.countdown?.kind !== b.countdown?.kind || a.countdown?.endsAt !== b.countdown?.endsAt) return false;
  if (a.bars.me.sub !== b.bars.me.sub || a.bars.opp.sub !== b.bars.opp.sub) return false;
  if (a.bars.me.state !== b.bars.me.state || a.bars.opp.state !== b.bars.opp.state) return false;
  return a.status?.code === b.status?.code && a.toast === b.toast && a.tick === b.tick;
}
