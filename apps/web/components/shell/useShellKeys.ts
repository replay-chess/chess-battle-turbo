"use client";

import { useEffect, useRef } from "react";
import { trackShell } from "@/lib/analytics/shell-events";
import { COARSE_MQ } from "@/lib/layout/media-queries";
import {
  CHORD_TIMEOUT_MS,
  MODAL_OPEN_SELECTOR,
  SHELL_DIALOG_ATTR,
  shellChords,
  classifyKeydown,
  createChordMachine,
  isEditableTarget,
  type ChordMachine,
} from "@/lib/shell/keys";
import { singleKeyEnabledNow } from "@/lib/shell/prefs";

const CHORD_DEST: Record<string, "play" | "legends" | "review"> = { "/play": "play", "/legends": "legends", "/games": "review" };

/** A modal that is not one of the shell's own dialogs is open (legacy modals, Clerk, iOS install). */
function nonShellModalOpen(): boolean {
  for (const el of document.querySelectorAll(MODAL_OPEN_SELECTOR)) {
    if (!el.closest(`[${SHELL_DIALOG_ATTR}]`)) return true;
  }
  return false;
}

/**
 * The shell's one keydown listener (SPEC 8.2 Keys, D20). ⌘K/Ctrl+K toggles the
 * palette everywhere; `/`, `?` and the G chords need a fine pointer, no field,
 * no modal and the Single-Key Shortcuts switch on.
 */
export function useShellKeys({
  paletteOpen,
  shortcutsOpen,
  setPaletteOpen,
  setShortcutsOpen,
  navigate,
  demo = false,
  reviewV3 = false,
}: {
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  navigate: (href: string) => void;
  demo?: boolean;
  /** `review-v3`: G then R goes to My Games (P3). */
  reviewV3?: boolean;
}) {
  const chords = useRef<{ reviewV3: boolean; machine: ChordMachine } | null>(null);

  useEffect(() => {
    if (chords.current?.reviewV3 !== reviewV3) {
      chords.current = { reviewV3, machine: createChordMachine({ timeoutMs: CHORD_TIMEOUT_MS, chords: shellChords({ reviewV3 }) }) };
    }
    const machine = chords.current.machine;

    const onKeyDown = (e: KeyboardEvent) => {
      const action = classifyKeydown(e, {
        coarse: window.matchMedia(COARSE_MQ).matches,
        singleKeyEnabled: singleKeyEnabledNow(),
        modalOpen: nonShellModalOpen(),
        shellDialogOpen: paletteOpen || shortcutsOpen,
        editable: isEditableTarget(e.target),
      });
      switch (action) {
        case "palette": {
          e.preventDefault();
          if (shortcutsOpen) {
            // Never stack modals: the shortcuts dialog gives way to the palette.
            setShortcutsOpen(false);
            setPaletteOpen(true);
          } else {
            setPaletteOpen(!paletteOpen);
          }
          if (!paletteOpen) trackShell({ name: "shell_palette_opened", via: "shortcut" }, { demo });
          return;
        }
        case "slash":
          e.preventDefault();
          setPaletteOpen(true);
          trackShell({ name: "shell_palette_opened", via: "slash" }, { demo });
          return;
        case "help":
          e.preventDefault();
          setShortcutsOpen(true);
          trackShell({ name: "shell_shortcuts_opened", via: "key" }, { demo });
          return;
        case "chord-key": {
          const result = machine.press(e.code, e.key, e.timeStamp || performance.now());
          if (result.navigate) {
            e.preventDefault();
            const dest = CHORD_DEST[result.navigate];
            if (dest) trackShell({ name: "shell_nav_click", dest, surface: "chord" }, { demo });
            navigate(result.navigate);
          }
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [paletteOpen, shortcutsOpen, setPaletteOpen, setShortcutsOpen, navigate, demo, reviewV3]);
}
