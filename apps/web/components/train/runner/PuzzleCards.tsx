"use client";

// The puzzle panel's two cards (V3PuzzleSolve): "This puzzle" (theme, puzzle rating, source, the Lichess credit line
// of plan §7.7, and the look line that turns into the theme's look text after a hint; while solving only, not in the
// wrong state) and "Session" ("Puzzle 1 of 10 · Streak 4 · Rating 1512", the
// progress bar and the last results as dots, `role="img"`).
import { Check, Eye, X } from "lucide-react";
import type { TrainItem } from "@repo/contracts/http/train";

/** The Lichess database credit (plan §7.7; CC0, credited all the same). */
export const PUZZLE_CREDIT = "Puzzles from the Lichess open database (CC0)";

export function PuzzleCard({ item, hinted }: { item: TrainItem; hinted: boolean }) {
  const look = hinted && item.text.look ? item.text.look : "Press Hint to see what to look for.";
  return (
    <>
      <section className="tr-card tr-side-only" aria-label="This puzzle" data-testid="trainer-puzzle-card">
        <span className="tr-lbl">This puzzle</span>
        <div className="tr-kv">
          <span>Theme</span>
          <span>{item.theme.label}</span>
        </div>
        {item.rating !== null ? (
          <div className="tr-kv">
            <span>Puzzle rating</span>
            <span className="tr-mono">{item.rating}</span>
          </div>
        ) : null}
        <div className="tr-kv">
          <span>Source</span>
          <span>{item.sourceLabel}</span>
        </div>
        {item.puzzleId ? (
          <p className="tr-credit" data-testid="trainer-puzzle-credit">
            {PUZZLE_CREDIT}
          </p>
        ) : null}
      </section>
      <div className="tr-rule tr-side-only tr-tall" data-on={hinted ? "" : undefined}>
        <Eye aria-hidden="true" size={16} />
        <span>{look}</span>
      </div>
    </>
  );
}

/** "Last 6 results: 4 right, 2 wrong". */
export function resultsAria(results: readonly boolean[]): string {
  const ok = results.filter(Boolean).length;
  return `Last ${results.length} results: ${ok} right, ${results.length - ok} wrong`;
}

export function SessionCard({ label, pct, results }: { label: string; pct: number; results: readonly boolean[] }) {
  return (
    <section className="tr-sess tr-side-only" aria-labelledby="tr-sess-h" data-testid="trainer-session-card">
      {/* "Session" never truncates; the line moves under it when the panel is narrow (1280 px, zoom: FIX-1). */}
      <div className="tr-sess__head">
        <h2 id="tr-sess-h" className="tr-lbl" style={{ margin: 0 }}>
          Session
        </h2>
        <span className="tr-mono tr-sess__line">{label}</span>
      </div>
      <div className="tr-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      {results.length ? (
        <div className="tr-head__row">
          <span style={{ fontSize: "0.8125rem", color: "var(--cb-text-secondary, var(--cb-text-soft))" }}>Last results</span>
          <span role="img" aria-label={resultsAria(results)} className="tr-dots">
            {results.map((ok, i) => (
              <span key={i} className="tr-dot" data-ok={ok ? "" : undefined} aria-hidden="true">
                {ok ? <Check size={10} strokeWidth={3.5} /> : <X size={10} strokeWidth={3.5} />}
              </span>
            ))}
          </span>
        </div>
      ) : null}
    </section>
  );
}
