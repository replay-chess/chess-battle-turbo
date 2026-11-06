"use client";

// The game page's keyboard shortcuts (P2 plan 4.6.1; rows in the V3Shortcuts "In a Game" section,
// lib/shell/keys.ts): ←/→ previous/next ply, ↑/↓ first/latest, F flip, M sound, D offer draw (live, playing),
// H hint and U undo (bot games), Esc cancels a premove. One window listener while the screen is mounted; it reads
// the store and the view at key time, so it never holds stale state. ⌘K and ? stay with the shell.

import { useEffect } from "react";
import { absPly } from "@repo/game-core/client/reducer";
import { trackGame } from "@/lib/analytics/game-events";
import { COARSE_MQ } from "@/lib/layout/media-queries";
import { MODAL_OPEN_SELECTOR, isEditableTarget } from "@/lib/shell/keys";
import { singleKeyEnabledNow } from "@/lib/shell/prefs";
import { useController, usePrefs } from "../screen/GameContext";
import { viewSourceFor } from "../viewState";
import { withTelemetry } from "../telemetryLazy";
import { ARROW_WIDGET_SELECTOR, gameHotkeyFor, type GameHotkey } from "./hotkeys";

/** Any modal, including the shell's own palette and shortcuts dialogs: keys typed there are not game keys. */
function modalOpen(): boolean {
  return document.querySelector(MODAL_OPEN_SELECTOR) !== null;
}

function closest(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

export function useGameHotkeys(): void {
  const controller = useController();
  const prefs = usePrefs();
  const { flipped, setFlipped, sound, setSound } = prefs;

  useEffect(() => {
    const run = (key: GameHotkey): boolean => {
      const { store } = controller;
      const g = store.getState();
      const s = g.state;
      const live = absPly(s);
      const current = g.view ?? live;
      const view = (to: number) => store.dispatch({ type: "view", ply: to >= live ? null : Math.max(s.startPly, to) });
      switch (key) {
        case "prev":
          if (current <= s.startPly) return false;
          view(current - 1);
          return true;
        case "next":
          if (g.view === null) return false;
          view(current + 1);
          return true;
        case "first":
          if (current <= s.startPly) return false;
          view(s.startPly);
          return true;
        case "last":
          if (g.view === null) return false;
          view(live);
          return true;
        case "flip":
          setFlipped(!flipped);
          trackGame("flip_board", { on: !flipped });
          return true;
        case "sound":
          setSound(!sound);
          trackGame("sound_toggled", { on: !sound });
          return true;
        case "draw": {
          const v = viewSourceFor(controller).getSnapshot();
          if (s.phase !== "playing") return false;
          // Bot games: the local controller answers with the draw policy (needs 2 plies; cooldown after a decline).
          if (controller.kind === "local" ? v.actions !== "bot" || absPly(s) - s.startPly < 2 : v.actions !== "online" || v.draw.disabled) return false;
          controller.offerDraw();
          return true;
        }
        case "hint":
          if (!controller.hint || viewSourceFor(controller).getSnapshot().actions !== "bot") return false;
          controller.hint();
          return true;
        case "undo":
          if (!controller.undo || viewSourceFor(controller).getSnapshot().actions !== "bot") return false;
          controller.undo();
          return true;
        case "escape":
          if (!g.premove) return false;
          controller.setPremove(null);
          return true;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Radix menus own their keys (arrows, typeahead letters, Esc).
      if (closest(e.target, '[role="menu"], [role="menubar"]')) return;
      const key = gameHotkeyFor(e, {
        coarse: window.matchMedia(COARSE_MQ).matches,
        singleKeyEnabled: singleKeyEnabledNow(),
        editable: isEditableTarget(e.target),
        modalOpen: modalOpen(),
        arrowWidget: closest(e.target, ARROW_WIDGET_SELECTOR),
      });
      if (key && run(key)) {
        e.preventDefault();
        withTelemetry((t) => t.trackShortcut(key));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [controller, flipped, setFlipped, sound, setSound]);
}
