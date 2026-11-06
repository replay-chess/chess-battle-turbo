"use client";

// The controller context of one game screen (P2 plan 4.4 `GameControllerProvider`). Components read the derived
// view state (one cached derivation per store change, features/game/viewState.ts) and, where they need raw store
// fields, a narrow selector over the store. Screen-local state that is not game state (flipped board, sound) lives
// here too, so the menus, hotkeys and the board agree.

import { createContext, useContext, useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import type { ClientGame } from "@repo/game-core/client/reducer";
import type { GameController } from "../controller";
import { viewSourceFor, type ViewState } from "../viewState";

export interface ScreenPrefs {
  flipped: boolean;
  setFlipped(next: boolean): void;
  sound: boolean;
  setSound(next: boolean): void;
}

interface Ctx {
  controller: GameController;
  prefs: ScreenPrefs;
}

const GameCtx = createContext<Ctx | null>(null);

const SOUND_KEY = "rc:sound:v1";

function readSound(spectator: boolean): boolean {
  try {
    const v = window.localStorage.getItem(SOUND_KEY);
    if (v === "0") return false;
    if (v === "1") return !spectator;
  } catch {
    /* storage blocked: default */
  }
  return !spectator; // spectators: quiet by default (plan 4.6.2)
}

export function GameProvider({
  controller,
  initialFlipped = false,
  children,
}: {
  controller: GameController;
  /** The demo route's `flip=1`. */
  initialFlipped?: boolean;
  children: React.ReactNode;
}) {
  const spectator = controller.store.getState().state.you.role !== "player";
  const [flipped, setFlipped] = useState(initialFlipped);
  const [sound, setSoundState] = useState(() => (typeof window === "undefined" ? !spectator : readSound(spectator)));
  const setSound = (next: boolean) => {
    setSoundState(next);
    try {
      window.localStorage.setItem(SOUND_KEY, next ? "1" : "0");
    } catch {
      /* storage blocked: session only */
    }
  };
  return <GameCtx value={{ controller, prefs: { flipped, setFlipped, sound, setSound } }}>{children}</GameCtx>;
}

function useCtx(): Ctx {
  const ctx = useContext(GameCtx);
  if (!ctx) throw new Error("Game screen components must render inside <GameProvider>");
  return ctx;
}

export function useController(): GameController {
  return useCtx().controller;
}

export function usePrefs(): ScreenPrefs {
  return useCtx().prefs;
}

/** The derived view state (plan 4.3). */
export function useView(): ViewState {
  const source = viewSourceFor(useCtx().controller);
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getServerSnapshot);
}

/** A narrow selector over the raw client store. */
export function useGame<T>(selector: (g: ClientGame) => T): T {
  return useStore(useCtx().controller.store, selector);
}

/** Dispatch a UI-only action (selection, promotion, history view, toasts, resign popover). */
export function useDispatch(): GameController["store"]["dispatch"] {
  return useCtx().controller.store.dispatch;
}
