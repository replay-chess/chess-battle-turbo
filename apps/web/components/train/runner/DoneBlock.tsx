"use client";

// Session done (§4.4): "Session done · 3 of 3 graded. Next reviews are scheduled.", See Session Summary (Enter) and
// Start Again (a practice session over the same items). While attempts of this session still wait in the outbox,
// "Saving your results…" shows under the line; See Session Summary waits for the flush (≤ 3 s), then goes anyway.
import { Check } from "lucide-react";

export function doneLine(graded: number, total: number, stream: boolean): string {
  return stream ? `Session done · ${graded} graded. Next reviews are scheduled.` : `Session done · ${graded} of ${total} graded. Next reviews are scheduled.`;
}

export function DoneBlock({
  line,
  saving,
  leaving,
  note,
  onSummary,
  onAgain,
  canAgain,
}: {
  line: string;
  saving: boolean;
  leaving: boolean;
  /** "No more puzzles right now." when a stream could not extend. */
  note?: string | null;
  onSummary: () => void;
  onAgain: () => void;
  canAgain: boolean;
}) {
  return (
    <div className="tr-done tr-fadein" data-testid="trainer-done">
      <div className="tr-note" data-tone="good">
        <Check aria-hidden="true" size={18} />
        <span>{line}</span>
      </div>
      {note ? <p style={{ margin: 0, fontSize: "0.875rem" }}>{note}</p> : null}
      {saving ? (
        <p role="status" style={{ margin: 0, fontSize: "0.875rem", color: "var(--cb-text-soft)" }} data-testid="trainer-saving">
          Saving your results…
        </p>
      ) : null}
      <button type="button" className="tr-btn-p" onClick={onSummary} aria-busy={leaving || undefined} aria-keyshortcuts="Enter" data-testid="trainer-see-summary">
        See Session Summary
      </button>
      {canAgain ? (
        <button type="button" className="tr-btn-s" onClick={onAgain} data-testid="trainer-start-again">
          Start Again
        </button>
      ) : null}
    </div>
  );
}
