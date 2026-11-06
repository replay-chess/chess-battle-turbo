/**
 * Arrows (P2 plan §4.5.1): one SVG on a fixed viewBox (0 0 800 800, a square is
 * 100 units), so arrows never depend on the board's pixel size. Prop arrows and
 * the local right-drag arrows share the geometry; knight moves draw as an L.
 * Colours: DS `arrow-default`; drawn and coloured arrows use the `pv-*` hues at
 * 50 % shaft / 65 % head (DS ChessBoard README).
 */
import { fileIndex, rankOf, squareCenter } from "./geometry";
import type { Side, Sq } from "./types";

export interface ArrowSpec {
  from: Sq;
  to: Sq;
  color?: string;
}

interface Paint {
  shaft: string;
  head: string;
  shaftOpacity: number;
  headOpacity: number;
}

const PV: Record<string, string> = {
  green: "pv-1",
  blue: "pv-2",
  yellow: "pv-3",
  orange: "pv-3",
  purple: "pv-4",
  red: "pv-5",
};

export function arrowPaint(color?: string): Paint {
  const c = color?.trim();
  if (!c || c === "arrow-default" || c === "default") {
    return { shaft: "var(--arrow-default)", head: "var(--arrow-default-head)", shaftOpacity: 1, headOpacity: 1 };
  }
  const token = PV[c] ?? (/^pv-[1-5]$/.test(c) ? c : null);
  if (token) return { shaft: `var(--${token})`, head: `var(--${token})`, shaftOpacity: 0.5, headOpacity: 0.65 };
  if (/^[a-z][a-z0-9-]*-[a-z0-9-]+$/.test(c)) return { shaft: `var(--${c})`, head: `var(--${c})`, shaftOpacity: 0.85, headOpacity: 0.9 };
  return { shaft: c, head: c, shaftOpacity: 0.85, headOpacity: 0.9 };
}

const SHAFT = 18;
const HEAD_LEN = 42;
const HEAD_HALF = 26;
const TIP_INSET = 14;
const START_INSET = 20;

export interface ArrowGeometry {
  /** Shaft polyline ("M x y L x y [L x y]"). */
  d: string;
  /** Head triangle points. */
  head: string;
  knight: boolean;
}

/** Shaft and head for an arrow in viewBox units. */
export function arrowGeometry(from: Sq, to: Sq, orientation: Side): ArrowGeometry {
  const a = squareCenter(from, orientation);
  const b = squareCenter(to, orientation);
  const df = Math.abs(fileIndex(from) - fileIndex(to));
  const dr = Math.abs(rankOf(from) - rankOf(to));
  const knight = (df === 1 && dr === 2) || (df === 2 && dr === 1);
  // An L goes along its long leg first.
  const corner = knight ? (Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y }) : null;
  const lastFrom = corner ?? a;
  const ldx = b.x - lastFrom.x;
  const ldy = b.y - lastFrom.y;
  const llen = Math.hypot(ldx, ldy) || 1;
  const ux = ldx / llen;
  const uy = ldy / llen;
  const tip = { x: b.x - ux * TIP_INSET, y: b.y - uy * TIP_INSET };
  const base = { x: tip.x - ux * HEAD_LEN, y: tip.y - uy * HEAD_LEN };
  const nx = -uy * HEAD_HALF;
  const ny = ux * HEAD_HALF;
  const fdx = (corner ?? b).x - a.x;
  const fdy = (corner ?? b).y - a.y;
  const flen = Math.hypot(fdx, fdy) || 1;
  const start = { x: a.x + (fdx / flen) * START_INSET, y: a.y + (fdy / flen) * START_INSET };
  const r = (n: number) => Math.round(n * 10) / 10;
  const d = corner
    ? `M ${r(start.x)} ${r(start.y)} L ${r(corner.x)} ${r(corner.y)} L ${r(base.x)} ${r(base.y)}`
    : `M ${r(start.x)} ${r(start.y)} L ${r(base.x)} ${r(base.y)}`;
  const head = `${r(tip.x)},${r(tip.y)} ${r(base.x + nx)},${r(base.y + ny)} ${r(base.x - nx)},${r(base.y - ny)}`;
  return { d, head, knight };
}

export function ArrowLayer({
  arrows,
  orientation,
}: {
  arrows: readonly (ArrowSpec & { key: string; source: "prop" | "drawn" | "preview" })[];
  orientation: Side;
}) {
  return (
    <svg className="rc-bd-arrows" viewBox="0 0 800 800" aria-hidden="true" focusable="false" data-arrow-count={arrows.length}>
      {arrows.map((a) => {
        if (a.from === a.to) return null;
        const g = arrowGeometry(a.from, a.to, orientation);
        const p = arrowPaint(a.color);
        return (
          <g key={a.key} data-arrow={`${a.from}${a.to}`} data-source={a.source}>
            <path
              d={g.d}
              fill="none"
              strokeWidth={SHAFT}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ stroke: p.shaft, strokeOpacity: p.shaftOpacity }}
            />
            {/* Colours go through style: var() is not valid in SVG presentation attributes. */}
            <polygon points={g.head} style={{ fill: p.head, fillOpacity: p.headOpacity }} />
          </g>
        );
      })}
    </svg>
  );
}
