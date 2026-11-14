"use client";

// "Drill · 2 of 3" / "Session · 1 of 10" with one segment per item (done, now, next). Long streams cap the segments
// (the label carries the count); the segments are decoration, the label is what is read.
const MAX_SEGMENTS = 6;

export function SessionProgress({ label, index, total, solvedCurrent, done }: { label: string; index: number; total: number; solvedCurrent: boolean; done: boolean }) {
  const shown = Math.min(total, MAX_SEGMENTS);
  const offset = total > MAX_SEGMENTS ? Math.min(Math.max(0, index - Math.floor(MAX_SEGMENTS / 2)), total - MAX_SEGMENTS) : 0;
  return (
    <div className="tr-head__row">
      <span className="tr-lbl" data-testid="trainer-progress">
        {label}
      </span>
      <span className="tr-prog" aria-hidden="true">
        {Array.from({ length: shown }, (_, k) => {
          const i = k + offset;
          const state = done || i < index || (i === index && solvedCurrent) ? "done" : i === index ? "now" : "next";
          return <span key={i} data-s={state} />;
        })}
      </span>
    </div>
  );
}
