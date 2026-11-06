/**
 * Square overlays (P2 plan §4.5.1 OverlayLayer), drawn inside each cell below
 * the piece, bottom to top: last move, highlight ("hl"), selection, premove,
 * check, ring, then the legal-move dot or capture corners. The dot keeps the
 * `.rounded-full` class and the corners keep the inline rgba(220, 80, 80, …)
 * style: the e2e fixture (e2e/fixtures/chess-board.ts) finds targets by them.
 */
import type { CSSProperties } from "react";

/** Capture corners: four triangles (DS board-capture). Inline on purpose (fixture hook). */
const CAPTURE_STYLE: CSSProperties = {
  background:
    "linear-gradient(135deg, rgba(220, 80, 80, 0.45) 0 16%, transparent 16%), linear-gradient(225deg, rgba(220, 80, 80, 0.45) 0 16%, transparent 16%), linear-gradient(45deg, rgba(220, 80, 80, 0.45) 0 16%, transparent 16%), linear-gradient(315deg, rgba(220, 80, 80, 0.45) 0 16%, transparent 16%)",
};

const TOKEN = /^[a-z][a-z0-9-]*$/;
const NAMED_HIGHLIGHT: Record<string, string> = {
  green: "highlight-green",
  red: "highlight-red",
  blue: "highlight-blue",
  orange: "highlight-orange",
  purple: "highlight-purple",
  yellow: "highlight-yellow",
};

/**
 * A highlight value as a CSS background: a gradient passes through, a DS token
 * name ("highlight-green", "board-last-move") or a short colour name becomes the
 * token, anything else is treated as a colour.
 */
export function highlightFill(value: string): string {
  const v = value.trim();
  if (v.includes("gradient(")) return v;
  if (NAMED_HIGHLIGHT[v]) return `linear-gradient(var(--${NAMED_HIGHLIGHT[v]}), var(--${NAMED_HIGHLIGHT[v]}))`;
  if (TOKEN.test(v) && v.includes("-")) return `linear-gradient(var(--${v}), var(--${v}))`;
  return `linear-gradient(${v}, ${v})`;
}

export function ringShadow(value: string): string {
  const v = value.trim();
  const c = TOKEN.test(v) && v.includes("-") ? `var(--${v})` : v;
  return `inset 0 0 0 3px ${c}`;
}

export interface SquareMarksProps {
  last: boolean;
  highlight?: string;
  selected: boolean;
  premove: boolean;
  check: boolean;
  ring?: string;
  target?: "dot" | "cap";
}

export function SquareMarks({ last, highlight, selected, premove, check, ring, target }: SquareMarksProps) {
  return (
    <>
      {last ? <span aria-hidden="true" className="rc-bd-mark rc-bd-last" data-mark="last" /> : null}
      {highlight ? (
        <span aria-hidden="true" className="rc-bd-mark" data-mark="hl" style={{ background: highlightFill(highlight) }} />
      ) : null}
      {selected ? <span aria-hidden="true" className="rc-bd-mark rc-bd-sel" data-mark="selected" /> : null}
      {premove ? <span aria-hidden="true" className="rc-bd-mark rc-bd-pm" data-mark="premove" /> : null}
      {check ? <span aria-hidden="true" className="rc-bd-mark rc-bd-check" data-mark="check" /> : null}
      {ring ? <span aria-hidden="true" className="rc-bd-mark" data-mark="ring" style={{ boxShadow: ringShadow(ring) }} /> : null}
      {target === "dot" ? <span aria-hidden="true" className="rc-bd-dot rounded-full" data-mark="dot" /> : null}
      {target === "cap" ? <span aria-hidden="true" className="rc-bd-cap" data-mark="capture" style={CAPTURE_STYLE} /> : null}
    </>
  );
}
