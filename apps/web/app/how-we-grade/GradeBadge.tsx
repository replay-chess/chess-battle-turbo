// A 28 px move-quality badge (DR/V3HowWeGrade.dc.html `.lg` rows): the owner's icon from public/board_icons, the
// same art the board draws (components/board/BadgeLayer.tsx `badgeIcon`), or the DS glyph disc for the one label
// without an icon (Interesting, "!?"). Decorative: the label name sits next to it.
import { badgeIcon } from "@/components/board/BadgeLayer";
import { parsePlacement } from "@/components/board/geometry";
import type { MoveQuality } from "@/components/board/types";

const EMPTY = parsePlacement("8/8/8/8/8/8/8/8 w - - 0 1");

export function GradeBadge({ kind }: { kind: MoveQuality }) {
  const icon = badgeIcon(kind, "a1", EMPTY);
  if (icon) {
    // eslint-disable-next-line @next/next/no-img-element -- static SVG icon from /public, decorative
    return <img src={icon} alt="" aria-hidden="true" width={28} height={28} className="size-7 shrink-0" data-badge={kind} />;
  }
  return (
    <span
      aria-hidden="true"
      data-badge={kind}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-mq-interesting font-mono text-xs leading-none font-bold tracking-[-0.04em] text-white"
    >
      !?
    </span>
  );
}
