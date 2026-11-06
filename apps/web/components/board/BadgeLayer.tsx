/**
 * Badges (P2 plan §4.5.1, §4.3): move-quality and end-of-game marks at the
 * top-right corner of a square, 34 % of the square, offset −9 % and clamped
 * inside the board on the top row and the right column (relative to the
 * orientation). The icons are the owner's own (public/board_icons/svg); the
 * DS `mq-*` tokens are colours only, used by the one label without an icon.
 */
import { displayPos, pieceColor, type Placement } from "./geometry";
import type { BadgeKind, BoardBadge, Side, Sq } from "./types";

const ICON: Partial<Record<BadgeKind, string>> = {
  brilliant: "brilliant",
  great: "great_find",
  best: "best",
  excellent: "excellent",
  good: "good",
  book: "book",
  forced: "forced",
  inaccuracy: "inaccuracy",
  mistake: "mistake",
  miss: "missed_win",
  blunder: "blunder",
  win: "winner",
};

/** End-of-game icons that come in a white and a black version (the colour of the king on the square). */
const BY_COLOR: Partial<Record<BadgeKind, string>> = { mate: "checkmate", flag: "resign", draw: "draw" };

/** Labels without an owner icon: a DS disc with the glyph. */
const GLYPH: Partial<Record<BadgeKind, { text: string; token: string }>> = {
  interesting: { text: "!?", token: "mq-interesting" },
};

export function badgeIcon(kind: BadgeKind, sq: Sq, placement: Placement): string | null {
  const plain = ICON[kind];
  if (plain) return `/board_icons/svg/${plain}.svg`;
  const pair = BY_COLOR[kind];
  if (pair) {
    const p = placement.get(sq);
    const c = p ? pieceColor(p) : "w";
    return `/board_icons/svg/${pair}_${c === "w" ? "white" : "black"}.svg`;
  }
  return null;
}

const SIZE = 4.25; // 34 % of a 12.5 % square
const OFFSET = 1.125; // 9 % of a square

/** Left/top of a badge box in % of the board. */
export function badgePosition(sq: Sq, orientation: Side): { left: number; top: number } {
  const { col, row } = displayPos(sq, orientation);
  const left = Math.min((col + 1) * 12.5 - SIZE + OFFSET, 100 - SIZE);
  const top = Math.max(row * 12.5 - OFFSET, 0);
  return { left: Math.round(left * 1000) / 1000, top: Math.round(top * 1000) / 1000 };
}

export function BadgeLayer({
  badges,
  orientation,
  placement,
}: {
  badges: readonly BoardBadge[];
  orientation: Side;
  placement: Placement;
}) {
  if (!badges.length) return null;
  return (
    <div className="rc-bd-badges">
      {badges.map((b) => {
        const pos = badgePosition(b.sq, orientation);
        const icon = badgeIcon(b.kind, b.sq, placement);
        const glyph = GLYPH[b.kind];
        const style = { left: `${pos.left}%`, top: `${pos.top}%` };
        return (
          <span
            key={`${b.sq}-${b.kind}`}
            role="img"
            aria-label={b.label}
            title={b.label}
            className="rc-bd-badge"
            data-badge={b.kind}
            data-square-badge={b.sq}
            data-glyph={!icon && glyph ? "" : undefined}
            style={!icon && glyph ? { ...style, background: `var(--${glyph.token})` } : style}
          >
            {icon ? (
              // eslint-disable-next-line @next/next/no-img-element -- static SVG icon from /public; decorative (the span carries the label)
              <img src={icon} alt="" decoding="async" draggable={false} />
            ) : glyph ? (
              <span aria-hidden="true">{glyph.text}</span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
