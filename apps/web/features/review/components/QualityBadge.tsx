// The move-quality badge outside the board (V2Badge; 16 px in the phone strip, 18 px in the move list, 22 px in the
// counts table). The icons are the owner's own (public/board_icons/svg, the same ones the board draws); Interesting
// has no icon and renders the DS disc with its glyph.
import { badgeIcon } from "@/components/board/BadgeLayer";
import type { JudgementKey } from "../model";
import { QUALITY_LABEL } from "../copy";

const NO_PLACEMENT = new Map();

export function QualityBadge({ q, size, decorative = false }: { q: JudgementKey; size: 16 | 18 | 22; decorative?: boolean }) {
  const icon = badgeIcon(q, "a1", NO_PLACEMENT);
  const label = QUALITY_LABEL[q];
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img" as const, "aria-label": label, title: label };
  if (icon) {
    return (
      <span className="rv-badge" data-q={q} style={{ width: size, height: size }} {...a11y}>
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG icon from /public; the span carries the label */}
        <img src={icon} alt="" decoding="async" draggable={false} />
      </span>
    );
  }
  return (
    <span
      className="rv-badge"
      data-q={q}
      data-glyph=""
      style={{ width: size, height: size, background: `var(--mq-${q})`, fontSize: Math.round(size * 0.5) }}
      {...a11y}
    >
      <span aria-hidden="true">!?</span>
    </span>
  );
}
