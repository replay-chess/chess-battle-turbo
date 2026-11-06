"use client";

// Plays the game sounds (P2 plan 4.6.2) while the screen's sound pref is on (`M`, the ⋯ menu; `rc:sound:v1`).
// The bank is unlocked by the first pointer or key gesture on the page, never at mount. Cues come from comparing
// consecutive store states (sound/events.ts), so live, bot and demo controllers all sound the same.

import { useEffect, useRef } from "react";
import { useLowTimeAlert } from "../clock/useLowTimeAlert";
import { useController, usePrefs } from "../screen/GameContext";
import { soundCues } from "./events";
import { getSoundBank } from "./sounds";

export function useGameSounds(): void {
  const controller = useController();
  const { sound } = usePrefs();
  const on = useRef(sound);
  useEffect(() => {
    on.current = sound;
  }, [sound]);

  // First gesture → unlock (create the AudioContext, fetch and decode the files once per tab).
  useEffect(() => {
    if (!sound) return;
    const bank = getSoundBank();
    if (bank.unlocked) return;
    const unlock = () => {
      void bank.unlock();
      remove();
    };
    const opts = { capture: true, passive: true } as const;
    const remove = () => {
      window.removeEventListener("pointerdown", unlock, opts);
      window.removeEventListener("keydown", unlock, opts);
    };
    window.addEventListener("pointerdown", unlock, opts);
    window.addEventListener("keydown", unlock, opts);
    return remove;
  }, [sound]);

  useEffect(
    () =>
      controller.store.subscribe((next, prev) => {
        if (!on.current) return;
        const cues = soundCues(prev, next);
        if (!cues.length) return;
        const bank = getSoundBank();
        for (const c of cues) bank.play(c.name, c.gain);
      }),
    [controller],
  );

  useLowTimeAlert(() => {
    if (on.current) getSoundBank().play("tenseconds");
  });
}
