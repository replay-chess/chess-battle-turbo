// The per-game store (P2 plan 5.2.1, client-data-layer 5.7): a vanilla Zustand store per game instance holding
// the game-core `ClientGame`. All transitions go through the pure reducer `reduceClient` (unit-tested in
// @repo/game-core); `dispatch` returns the side effects (`Out[]`: socket commands, a sync, a navigation) for the
// controller to run. The live game is never in the TanStack Query cache.

import { createStore, type StoreApi } from "zustand/vanilla";
import {
  createClientGame,
  reduceClient,
  type ClientAction,
  type ClientGame,
  type ConnState,
  type Out,
} from "@repo/game-core/client/reducer";
import type { GameState } from "@repo/game-core/machine/types";
import { withTelemetry } from "./telemetryLazy";

export type GameStore = StoreApi<ClientGame> & {
  /** Runs one reducer step; returns the effects the controller must run (the store never runs them). */
  dispatch(action: ClientAction): Out[];
};

export interface GameStoreOptions {
  /** True for local (bot) and demo games: the snapshot is already authoritative. */
  joined?: boolean;
  conn?: ConnState;
  now?: number;
  bot?: boolean;
  /** This tab accepted the rematch that created this game. */
  acceptedRematch?: boolean;
}

export function createGameStore(state: GameState, opts: GameStoreOptions = {}): GameStore {
  const api = createStore<ClientGame>()(() => createClientGame(state, opts));
  const dispatch = (action: ClientAction): Out[] => {
    const prev = api.getState();
    const { store, out } = reduceClient(prev, action);
    if (store !== prev) api.setState(store, true);
    if (store !== prev || out.length > 0) withTelemetry((t) => t.observeTransition(prev, store, action, out, Date.now()));
    return out;
  };
  return Object.assign(api, { dispatch });
}

/** A short client move id (`[A-Za-z0-9_-]{1,16}`, contracts `ClientMoveId`): a counter plus random base36. */
let moveCounter = 0;
export function nextClientMoveId(): string {
  moveCounter = (moveCounter + 1) % 1_679_616; // 36^4
  const rnd = Math.floor(Math.random() * 2_176_782_336).toString(36); // 36^6
  return `${moveCounter.toString(36)}-${rnd}`.slice(0, 16);
}
