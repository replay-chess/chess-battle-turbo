"use client";

/**
 * Keyboard grid (P2 plan §4.5.3 rule 8, §4.5.5): one roving tab stop over the 64
 * cells; arrow keys move focus on the visual grid (ArrowUp is up the screen in
 * either orientation), Home/End jump along the row, Enter/Space activate the
 * cell (the button's own click, so screen readers take the same path), Esc
 * cancels the promotion, the selection, then the premove.
 */
import { useState, type KeyboardEvent, type RefObject } from "react";
import { displayPos, squareAtDisplay, stepSquare } from "./geometry";
import type { Side, Sq } from "./types";

export function useKeyboardBoard({
  rootRef,
  orientation,
  initial,
  cancel,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  orientation: Side;
  /** The tab stop before the user has moved focus (the selected square, else the bottom-left corner). */
  initial: Sq;
  cancel: () => boolean;
}) {
  const [focusSq, setFocusSq] = useState<Sq | null>(null);
  const tabStop = focusSq ?? initial;

  const focusCell = (sq: Sq) => {
    setFocusSq(sq);
    rootRef.current?.querySelector<HTMLElement>(`[data-square="${sq}"]`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    const sq = target.getAttribute?.("data-square") as Sq | null;
    if (e.key === "Escape") {
      if (cancel()) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (!sq || e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation(); // the game page's ←/→ ply shortcuts must not also fire
      focusCell(stepSquare(sq, e.key, orientation));
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const { row } = displayPos(sq, orientation);
      focusCell(squareAtDisplay(e.key === "Home" ? 0 : 7, row, orientation)!);
    }
  };

  return { tabStop, onKeyDown, onCellFocus: setFocusSq };
}
