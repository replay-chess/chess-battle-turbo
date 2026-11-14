// One Mistake Bank row (phase-05 plan §4.3 `BankRow`; DR/V3MistakeBank `.mrow`, 72 px): 56 px MiniBoard, the theme,
// a Due tag or the next-review label, the judgement badge with "You played Qd2", the game line and the mastery dots.
// A button: desktop and iPad select it (`aria-current`), phones open the runner at that card (the screen decides).
// The optional ⋯ menu (Remove From Bank, `bank-remove`) sits beside it, never inside (no nested controls).
import { MiniBoard } from "@/components/board/MiniBoard";
import { BADGE_ICON } from "@/components/board/badge-icons";
import type { BankRow as BankRowDTO } from "@repo/contracts/http/train";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { lastMoveSquares } from "../hub/parts";
import { judgementLabel, masteryLabel, rowBoardLabel, rowSubline } from "./model";

/** The owner's move-quality icon for a judgement (public/board_icons/svg), 16 or 18 px, labelled. */
export function JudgementBadge({ judgement, size }: { judgement: BankRowDTO["judgement"]; size: 16 | 18 }) {
  const file = BADGE_ICON[judgement];
  const label = judgementLabel(judgement);
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0 overflow-hidden rounded-full" style={{ width: size, height: size }}>
      {file ? (
        // eslint-disable-next-line @next/next/no-img-element -- static SVG icon from /public; the span carries the label
        <img src={`/board_icons/svg/${file}.svg`} alt="" width={size} height={size} decoding="async" draggable={false} className="block size-full" />
      ) : null}
    </span>
  );
}

/** Five dots, filled to the mastery level (`role="img"` "Mastery 2 of 5"). */
export function MasteryDots({ mastery, size = 7 }: { mastery: number; size?: 7 | 8 }) {
  return (
    <span role="img" aria-label={masteryLabel(mastery)} className="inline-flex shrink-0 gap-[3px]">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cn("rounded-full border border-cb-accent", i < mastery ? "bg-cb-accent" : "bg-transparent")}
          style={{ width: size, height: size }}
        />
      ))}
    </span>
  );
}

export function BankRowButton({
  row,
  current,
  onPick,
  tabIndex,
  buttonRef,
}: {
  row: BankRowDTO;
  current: boolean;
  onPick: (row: BankRowDTO) => void;
  tabIndex?: number;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-current={current ? "true" : undefined}
      tabIndex={tabIndex}
      onClick={() => onPick(row)}
      data-testid="bank-row"
      data-card={row.cardRef}
      data-due={row.isDue ? "" : undefined}
      className={cn(
        "flex min-h-[72px] w-full min-w-0 cursor-pointer items-center gap-3 border-0 bg-transparent px-3 py-2 text-left font-[inherit] text-cb-text transition-colors duration-150 hover:bg-cb-fill focus-visible:-outline-offset-2 [-webkit-tap-highlight-color:transparent]",
        "[content-visibility:auto] [contain-intrinsic-size:auto_72px]",
        current && "bg-cb-accent/8 shadow-[inset_2px_0_0_var(--cb-accent)]",
        "tabbar:px-0 tablet-portrait:px-0",
      )}
    >
      <MiniBoard fen={row.fen} orientation={row.orient} size={56} lastMove={lastMoveSquares(row.lastMove)} label={rowBoardLabel(row)} className="shrink-0" />
      <span className="flex min-w-0 flex-auto flex-col gap-[3px]">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-overline text-cb-text">{row.theme.label}</span>
          {row.isDue ? (
            <Tag tone="warn">Due</Tag>
          ) : (
            <span className="shrink-0 font-mono text-label normal-case tracking-normal text-cb-text-soft">{row.nextLabel}</span>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-ui text-cb-text/75">
          <JudgementBadge judgement={row.judgement} size={16} />
          <span className="truncate">
            You played <span className="font-mono">{row.playedSan}</span>
          </span>
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-cb-text-soft">{rowSubline(row)}</span>
          <MasteryDots mastery={row.mastery} />
        </span>
      </span>
    </button>
  );
}
