"use client";

// The theme picker (S6, §4.6; board V3PuzzleThemes and the device boards' `themes` state): "Theme · your mastery",
// Recommended first, the six design themes, then More Themes grouped Tactics / Mates / Endgames / Defence. Each row:
// "Forks 62% · 14 puzzles" with a bar; a theme never tried reads "New"; none near the rating → disabled with "No
// puzzles at your level yet". A popover under the theme chip on desktop, a bottom sheet on phones. Loaded lazily.
// Keys (§4.6, FIX-2): ↑/↓ (and Home/End) move between the enabled rows and More Themes, Enter picks, Esc closes, T
// toggles; on close, focus goes back to the control that opened the picker.
// Options come from the session payload's `themes`, else `GET /api/train/themes` (qk.train.themes(), 10 min).
import type { ThemeOption } from "@repo/contracts/http/train";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Disclosure } from "@/components/ui/disclosure";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { trainerKeyFor } from "@/features/train/useTrainerKeys";
import { themesQuery } from "@/lib/api/queries/train";
import { COARSE_MQ, TABBAR_MQ } from "@/lib/layout/media-queries";
import { isEditableTarget } from "@/lib/shell/key-target";
import { singleKeyEnabledNow } from "@/lib/shell/prefs";

/** How many options show before More Themes (Recommended + the six design themes). */
export const MAIN_THEMES = 7;

const GROUP_TITLE: Partial<Record<ThemeOption["group"], string>> = {
  tactics: "Tactics",
  material: "Tactics",
  special: "Tactics",
  mates: "Mates",
  endgames: "Endgames",
  defence: "Defence",
};

/** Recommended first, then the order given (the server's §8.11 picker order). */
export function splitThemes(options: readonly ThemeOption[]): { main: ThemeOption[]; more: { title: string; options: ThemeOption[] }[] } {
  const sorted = [...options].sort((a, b) => Number(b.recommended) - Number(a.recommended));
  const main = sorted.slice(0, MAIN_THEMES);
  const groups = new Map<string, ThemeOption[]>();
  for (const o of sorted.slice(MAIN_THEMES)) {
    const title = GROUP_TITLE[o.group] ?? "Tactics";
    groups.set(title, [...(groups.get(title) ?? []), o]);
  }
  const order = ["Tactics", "Mates", "Endgames", "Defence"];
  return { main, more: order.filter((t) => groups.has(t)).map((t) => ({ title: t, options: groups.get(t)! })) };
}

function Row({ o, current, onPick }: { o: ThemeOption; current: string | null; onPick: (key: string) => void }) {
  const selected = o.key === current;
  const disabled = o.available === 0;
  return (
    <button
      type="button"
      className="tr-theme"
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onPick(o.key)}
      data-theme={o.key}
    >
      <span className="tr-theme__in">
        <span className="tr-theme__top">
          <span>{o.label}</span>
          <span className="tr-mono" style={{ fontSize: "0.8125rem" }}>
            <span className="tr-vh">, mastery </span>
            {o.pct === null ? "New" : `${o.pct}%`}
          </span>
        </span>
        <span className="tr-theme__bar" aria-hidden="true">
          <span style={{ width: `${o.pct ?? 0}%` }} />
        </span>
        <span className="tr-theme__n tr-mono">
          <span className="tr-vh">, </span>
          {disabled ? "No puzzles at your level yet" : `${o.attempts} ${o.attempts === 1 ? "puzzle" : "puzzles"}`}
        </span>
      </span>
    </button>
  );
}

/** The focusable stops of the list in order: enabled theme rows and the More Themes summary (closed groups skipped). */
export function listStops(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button.tr-theme:not(:disabled), details > summary")].filter(
    (el) => !el.closest("details:not([open]) > :not(summary)"),
  );
}

/** ↑/↓/Home/End → the stop to focus (wrapping), or null for any other key. */
export function nextStop(stops: readonly HTMLElement[], current: Element | null, key: string): HTMLElement | null {
  if (stops.length === 0) return null;
  const i = current ? stops.indexOf(current as HTMLElement) : -1;
  if (key === "Home") return stops[0]!;
  if (key === "End") return stops[stops.length - 1]!;
  if (key === "ArrowDown") return stops[(i + 1) % stops.length]!;
  if (key === "ArrowUp") return stops[i <= 0 ? stops.length - 1 : i - 1]!;
  return null;
}

function onListKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
  const target = nextStop(listStops(e.currentTarget), document.activeElement, e.key);
  if (!target) return;
  e.preventDefault();
  target.focus();
}

/** The control that opened the picker: the panel's theme chip, or the top bar's themes button (whichever is shown). */
function openerControl(): HTMLElement | null {
  for (const id of ["trainer-theme-button", "trainer-topbar-themes"]) {
    const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const r = el?.getBoundingClientRect();
    if (el && r && r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/**
 * Focus back to the opener when the picker closes (FIX-2): the popover has only a virtual anchor and the sheet no
 * trigger, so Radix had nowhere to return focus and it fell to <body> after Esc or a pick. The element focused when
 * the picker opened wins; else the visible theme control.
 */
function useReturnFocus(open: boolean): void {
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      // The picker may have taken focus already (its content mounts first): then the opener is the visible theme control.
      const active = document.activeElement;
      const outside = active instanceof HTMLElement && active !== document.body && !active.closest('[data-testid="trainer-themes"]');
      opener.current = outside ? active : openerControl();
    }
    if (!open && wasOpen.current) {
      const target = opener.current;
      const id = requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        (target && target.isConnected ? target : openerControl())?.focus();
      });
      wasOpen.current = open;
      return () => cancelAnimationFrame(id);
    }
    wasOpen.current = open;
  }, [open]);
}

/** The theme chip the desktop popover hangs under: the panel's "Theme: Forks" (or the top bar's button when hidden). */
function anchorRect(): DOMRect {
  for (const id of ["trainer-theme-button", "trainer-topbar-themes"]) {
    const el = document.querySelector(`[data-testid="${id}"]`);
    const r = el?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) return r;
  }
  return new DOMRect(window.innerWidth - 16, 64, 0, 0);
}

/**
 * T toggles the picker (§4.5, §4.6): the second press closes it wherever focus is (the list, the sheet's Close
 * button, the page), with the same gates as the trainer's keys (fine pointer, single keys on, no text field). Capture
 * phase and `preventDefault`, so the trainer's own T handler does not open it again (FIX-1: a second T left it open).
 */
function useCloseOnT(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const key = trainerKeyFor(e, {
        coarse: window.matchMedia(COARSE_MQ).matches,
        singleKeyEnabled: singleKeyEnabledNow(),
        editable: isEditableTarget(e.target),
        modalOpen: false,
        onControl: false,
      });
      if (key !== "themes") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, close]);
}

export default function ThemePicker({
  open,
  onOpenChange,
  options: given,
  current,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: ThemeOption[] | null;
  current: string | null;
  onPick: (key: string) => void;
}) {
  const fetched = useQuery({ ...themesQuery(), enabled: open && !given });
  const options = given ?? fetched.data?.options ?? null;
  const { main, more } = options ? splitThemes(options) : { main: [], more: [] };
  // A popover under the theme chip on desktop and tablet landscape (V3PuzzleSolve-themes, §4.6 "P1 Popover"); a bottom
  // sheet in tab-bar mode. The surface is chosen when it opens and held while open (as ResponsiveDialog does).
  const tabbar = useMediaQuery(TABBAR_MQ);
  const [asSheet, setAsSheet] = useState(tabbar);
  if (!open && asSheet !== tabbar) setAsSheet(tabbar);
  const close = () => onOpenChange(false);
  useCloseOnT(open, close);
  useReturnFocus(open);
  const anchor = useRef({ getBoundingClientRect: anchorRect });

  const list = (
    <div className="tr-themes" onKeyDown={onListKeyDown}>
      <span className="tr-lbl" style={{ padding: "4px 14px 8px" }}>
        Theme · your mastery
      </span>
      {options ? null : (
        <p role="status" className="px-3.5 py-3 text-ui text-cb-text-soft">
          {fetched.isError ? "Themes are unavailable right now." : "Loading themes…"}
        </p>
      )}
      {main.map((o) => (
        <Row key={o.key} o={o} current={current} onPick={onPick} />
      ))}
      {more.length ? (
        <Disclosure summary="More Themes" className="mt-2">
          {more.map((g) => (
            <div key={g.title} role="group" aria-label={g.title}>
              <span className="tr-lbl" style={{ display: "block", padding: "10px 14px 4px" }}>
                {g.title}
              </span>
              {g.options.map((o) => (
                <Row key={o.key} o={o} current={current} onPick={onPick} />
              ))}
            </div>
          ))}
        </Disclosure>
      ) : null}
    </div>
  );

  if (asSheet) {
    return (
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Choose a Theme" size="sm" sheetHeight="90" data-testid="trainer-themes">
        {list}
      </ResponsiveDialog>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        aria-label="Choose a theme"
        width={356}
        align="end"
        sideOffset={6}
        className="tr-themes-pop gap-0 px-0 py-2 max-h-[min(var(--radix-popover-content-available-height),640px)] overflow-y-auto overscroll-contain"
        data-testid="trainer-themes"
        data-surface="popover"
        // Focus goes back to the opener (useReturnFocus), not to Radix's default (the virtual anchor has no element).
        onCloseAutoFocus={(e) => e.preventDefault()}
        // The theme chip toggles the picker itself: a press on it is not an "outside" press (else it closes, then reopens).
        onInteractOutside={(e) => {
          if (e.target instanceof Element && e.target.closest('[data-testid="trainer-theme-button"], [data-testid="trainer-topbar-themes"]')) e.preventDefault();
        }}
      >
        {list}
      </PopoverContent>
    </Popover>
  );
}
