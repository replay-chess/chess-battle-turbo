"use client";

// Segmented (SPEC 6.2; 02 §5.4, C13): a value picker with radio semantics, so the
// arrow keys move the selection. Never role="tab"; a control that switches panels
// is <Tabs variant="segmented">.
//
// FIX-2 (phase-04 plan §9.6): a WAI-ARIA radio group of plain buttons (roving tabindex, `aria-checked`, the
// `data-state` the styles read) instead of Radix RadioGroup, whose collection, roving-focus, presence and radio
// packages added ~10 kB gzip to every page with a segmented control (the onboarding Goals and Plan steps, /games).
// The arrows select as they move (arrowSelection, FIX-1), Tab enters at the selection, Space/Enter/click select.
import { useRef } from "react";
import { cn } from "@/lib/utils";
export type SegmentedItem<T extends string = string> = {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
};

export type SegmentedProps<T extends string = string> = {
  value: T;
  onValueChange: (v: T) => void;
  items: SegmentedItem<T>[];
  "aria-label": string;
  /** Full width, equal segments. */
  fill?: boolean;
  disabled?: boolean;
  name?: string;
  className?: string;
  "data-testid"?: string;
};

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);
const PREV_KEYS = new Set(["ArrowLeft", "ArrowUp"]);

/**
 * The value an arrow key selects (WAI-ARIA radio group: the arrows move AND select, wrapping, skipping disabled
 * items), or null for any other key. Radix moves the focus on the next tick and selects on that focus only while the
 * key is still down, so a quick press (a fast typist, assistive tech, automation) moved the focus and left the
 * selection behind (FIX-1); the group now selects from the keydown itself.
 */
export function arrowSelection<T extends string>(items: readonly SegmentedItem<T>[], value: T, key: string): T | null {
  const step = NEXT_KEYS.has(key) ? 1 : PREV_KEYS.has(key) ? -1 : 0;
  if (step === 0) return null;
  const enabled = items.filter((i) => !i.disabled);
  if (enabled.length === 0) return null;
  const at = enabled.findIndex((i) => i.value === value);
  const next = enabled[(((at < 0 ? (step > 0 ? -1 : 0) : at) + step) % enabled.length + enabled.length) % enabled.length]!;
  return next.value === value ? null : next.value;
}

/** The item that takes the Tab stop: the selected one, else the first enabled one (WAI-ARIA radio group). */
export function tabStopValue<T extends string>(items: readonly SegmentedItem<T>[], value: T): T | null {
  const enabled = items.filter((i) => !i.disabled);
  return (enabled.find((i) => i.value === value) ?? enabled[0])?.value ?? null;
}

export function Segmented<T extends string = string>({
  value,
  onValueChange,
  items,
  "aria-label": ariaLabel,
  fill = false,
  disabled,
  name,
  className,
  "data-testid": testId,
}: SegmentedProps<T>) {
  const group = useRef<HTMLDivElement>(null);
  const tabStop = tabStopValue(items, value);
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      aria-disabled={disabled || undefined}
      data-disabled={disabled ? "" : undefined}
      data-testid={testId}
      onKeyDown={(event) => {
        if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
        const next = arrowSelection(items, value, event.key);
        if (next === null) return;
        event.preventDefault();
        onValueChange(next);
        const target = [...(group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])].find((el) => el.value === next);
        target?.focus();
      }}
      className={cn(
        "border border-cb-border-strong bg-cb-surface",
        fill ? "flex w-full" : "inline-flex max-w-full",
        className,
      )}
    >
      {name ? <input type="hidden" name={name} value={value} /> : null}
      {items.map((item) => {
        const checked = item.value === value;
        const off = disabled || item.disabled;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            value={item.value}
            aria-checked={checked}
            data-state={checked ? "checked" : "unchecked"}
            data-disabled={off ? "" : undefined}
            disabled={off}
            tabIndex={item.value === tabStop ? 0 : -1}
            onClick={() => {
              if (!checked) onValueChange(item.value);
            }}
            className={cn(
              "tap-target inline-flex min-h-[2.375rem] items-center justify-center gap-1.5 border-0 border-r border-cb-border-strong bg-transparent px-3.5 whitespace-nowrap last:border-r-0 pointer-coarse:min-h-11",
              "cursor-pointer text-ui text-cb-text-soft transition-colors duration-150 [-webkit-tap-highlight-color:transparent] [&_svg]:size-4 [&_svg]:shrink-0",
              "hover:bg-cb-fill hover:text-cb-text active:bg-cb-fill focus-visible:-outline-offset-2",
              "data-[state=checked]:bg-cb-accent data-[state=checked]:text-cb-accent-fg",
              "forced-colors:data-[state=checked]:outline forced-colors:data-[state=checked]:outline-2 forced-colors:data-[state=checked]:-outline-offset-2",
              "disabled:cursor-not-allowed disabled:text-cb-text-disabled",
              // Equal segments may wrap their label rather than push the row past its box.
              fill && "min-w-0 flex-1 basis-0 py-1 text-center leading-tight whitespace-normal",
            )}
          >
            {item.icon ? (
              <span aria-hidden="true" className="inline-flex">
                {item.icon}
              </span>
            ) : null}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
