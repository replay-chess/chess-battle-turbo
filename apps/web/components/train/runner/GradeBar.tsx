"use client";

// The grade bar (§4.4): `role="group"` "How well did you know it?", Again / Hard / Good / Easy with each grade's real
// interval from the item's preview ("< 10 min", "2 days", "4 days", "9 days"), the suggested one primary (48 px+ high,
// keys 1–4, Enter = suggested). Any grade can be chosen. Practice items (no preview) show the bar without intervals.
// When it appears below the visible part of the panel's scroll body (iPad portrait and landscape zoomed in, short
// stacked panels), the body scrolls it into view: the decision is on screen at every zoom without reordering the
// design (coach first, then the grade bar) and without moving any layout (a scroll is not a layout shift; FIX-1).
import { useEffect, useRef } from "react";
import type { GradePreviews } from "@repo/contracts/http/train";
import type { GradeKey } from "@repo/chess-training/grade";

/**
 * How far the scroll body must scroll for a box to be in view: `bottom` is the lower of the scroller's and the
 * viewport's bottom; the box's top never goes above the scroller's top. 0 when it is in view already. Pure.
 */
export function scrollToReveal(box: { top: number; bottom: number }, area: { top: number; bottom: number }, margin = 8): number {
  const over = box.bottom + margin - area.bottom;
  if (over <= 0) return 0;
  return Math.max(0, Math.min(over, box.top - area.top));
}

export const GRADE_LABELS: Record<GradeKey, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
export const GRADE_ORDER: GradeKey[] = ["again", "hard", "good", "easy"];
const ORDER = GRADE_ORDER;

export function GradeBar({
  preview,
  suggested,
  note,
  onGrade,
}: {
  preview: GradePreviews | null;
  suggested: GradeKey;
  note: string;
  onGrade: (g: GradeKey) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const body = el?.closest<HTMLElement>("[data-rc-scroll]");
    if (!el || !body) return;
    const b = el.getBoundingClientRect();
    const s = body.getBoundingClientRect();
    const by = scrollToReveal(b, { top: s.top, bottom: Math.min(s.bottom, window.innerHeight) });
    if (by > 0) body.scrollTop += by;
  }, []);
  return (
    <div ref={ref} className="tr-grade tr-fadein" role="group" aria-label="How well did you know it?" data-testid="trainer-grades">
      <span className="tr-lbl" aria-hidden="true">
        How well did you know it?
      </span>
      <div className="tr-grade__row">
        {ORDER.map((g, i) => (
          <button
            key={g}
            type="button"
            className={g === suggested ? "tr-btn-p" : "tr-btn-s"}
            onClick={() => onGrade(g)}
            aria-keyshortcuts={String(i + 1)}
            data-grade={g}
            data-suggested={g === suggested ? "" : undefined}
          >
            {/* Named by its text (WCAG 2.5.3 label in name): "Good, next review in 4 days, suggested". */}
            <span>{GRADE_LABELS[g]}</span>
            {preview ? (
              <>
                <span className="tr-vh">, next review in </span>
                <span className="tr-grade__when tr-mono">{preview[g].label}</span>
              </>
            ) : (
              <span className="tr-vh">, practice: no schedule change</span>
            )}
            {g === suggested ? <span className="tr-vh">, suggested</span> : null}
          </button>
        ))}
      </div>
      <p className="tr-grade__note">{note}</p>
    </div>
  );
}
