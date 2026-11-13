"use client";

// The Level step's band picker (phase-04 plan §4.4; V3OnbRating): a radiogroup of six chips with role="radio" and
// aria-checked only (the board's extra aria-pressed is dropped, inv-pub §2.16). Roving tabindex: one chip is in the
// tab order (the checked one, else the first); ←/→/↑/↓ move and select, Home/End jump, Space selects, Enter submits
// the form (Continue).
import { useRef } from "react";
import type { RatingBandDb } from "@repo/contracts/http/p04-plain";

export const BAND_OPTIONS: readonly { band: RatingBandDb; label: string }[] = [
  { band: "NEW_TO_CHESS", label: "New to chess" },
  { band: "UNDER_800", label: "Under 800" },
  { band: "R800_1200", label: "800–1200" },
  { band: "R1200_1600", label: "1200–1600" },
  { band: "R1600_2000", label: "1600–2000" },
  { band: "R2000_PLUS", label: "2000+" },
];

export type BandPickerProps = {
  value: RatingBandDb | null;
  onChange: (band: RatingBandDb) => void;
  /** Id of the element that describes the group (the band note). */
  describedBy?: string;
  groupRef?: React.Ref<HTMLDivElement>;
};

export function BandPicker({ value, onChange, describedBy, groupRef }: BandPickerProps) {
  const chips = useRef<(HTMLButtonElement | null)[]>([]);
  const focusIndex = value ? BAND_OPTIONS.findIndex((o) => o.band === value) : 0;

  const move = (from: number, delta: number | "first" | "last") => {
    const n = BAND_OPTIONS.length;
    const to = delta === "first" ? 0 : delta === "last" ? n - 1 : (from + delta + n) % n;
    onChange(BAND_OPTIONS[to]!.band);
    chips.current[to]?.focus();
  };

  const onKeyDown = (i: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(i, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        if (e.altKey) return; // Alt+← is the frame's "back"
        e.preventDefault();
        move(i, -1);
        break;
      case "Home":
        e.preventDefault();
        move(i, "first");
        break;
      case "End":
        e.preventDefault();
        move(i, "last");
        break;
      case " ":
        e.preventDefault();
        onChange(BAND_OPTIONS[i]!.band);
        break;
      case "Enter":
        // A button's Enter would "click" it; on the band picker Enter means Continue (§4.4).
        e.preventDefault();
        e.currentTarget.form?.requestSubmit();
        break;
      default:
        break;
    }
  };

  return (
    <div className="onb-grow" role="radiogroup" aria-label="Rating band" aria-describedby={describedBy} ref={groupRef} data-testid="onb-band-picker">
      {BAND_OPTIONS.map((o, i) => {
        const checked = value === o.band;
        return (
          <button
            key={o.band}
            ref={(el) => {
              chips.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === focusIndex ? 0 : -1}
            className="onb-chip"
            data-band={o.band.toLowerCase()}
            onClick={() => onChange(o.band)}
            onKeyDown={onKeyDown(i)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
