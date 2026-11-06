// Focus return for the game screen's overlays (plan 4.5.5, 4.6; WCAG 2.4.3; FIX-A). Several overlays open without a
// Radix trigger (the resign confirm comes from a menu item, the promotion picker from a drag, the offer bars and the
// Watch Another Game sheet replace themselves), so when they close, the focused element is removed and focus falls to
// <body>. This puts it back on the control that had focus before the overlay (the ⋯ button, the action), or on the
// board when that control is gone.
//
// A deliberate click on a non-focusable spot (which also leaves focus on <body>) is left alone: only a focus loss
// whose last pointer target was removed from the document, or a keyboard close, is restored.

const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [data-rc-overlay]';
/** The board's tabbable square (roving tabindex), the fallback when the opener is gone. */
const BOARD_FOCUS = '[data-testid="game-board-container"] [data-square][tabindex="0"]';
const CONTROL = 'button, [role="button"], a[href], [tabindex="0"]';

function visible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

/** Installs the listeners; returns their removal. Loaded lazily by useFocusRestore (route budget, plan 9.1). */
export function installFocusRestore(): () => void {
  let opener: HTMLElement | null = null;
  let pointerTarget: Element | null = null;
  let pointerAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // The element that had focus last (anywhere). Chrome fires no focusout when a focused element is REMOVED (an
  // overlay closing), so a MutationObserver notices that case: the last focused element left the document.
  let lastFocused: HTMLElement | null = null;
  const onFocusIn = (e: FocusEvent) => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || t === document.body) return;
    lastFocused = t;
    if (!t.closest(OVERLAY)) opener = t;
  };
  const onPointerDown = (e: PointerEvent) => {
    pointerTarget = e.target instanceof Element ? e.target : null;
    pointerAt = performance.now();
    // Radix menu triggers keep focus off themselves on pointerdown, so a pointer-opened ⋯ never gets a focusin:
    // the control under the pointer is the opener then.
    const control = pointerTarget?.closest<HTMLElement>(CONTROL);
    if (control && !control.closest(OVERLAY)) opener = control;
  };
  const observer = new MutationObserver(() => {
    if (lastFocused && !lastFocused.isConnected && (!document.activeElement || document.activeElement === document.body)) {
      lastFocused = null;
      onFocusOut();
    }
  });
  const onFocusOut = () => {
    if (timer) clearTimeout(timer);
    // After Radix's own close-autofocus (setTimeout 0) has run.
    timer = setTimeout(() => {
      timer = null;
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const recentClick = performance.now() - pointerAt < 600;
      if (recentClick && pointerTarget?.isConnected && !pointerTarget.closest(OVERLAY)) return;
      const target =
        opener && visible(opener)
          ? opener
          : [...document.querySelectorAll<HTMLElement>(BOARD_FOCUS)].find((el) => visible(el)) ?? null;
      target?.focus({ preventScroll: true });
    }, 40);
  };

  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("pointerdown", onPointerDown, true);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    if (timer) clearTimeout(timer);
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    document.removeEventListener("pointerdown", onPointerDown, true);
  };
}
