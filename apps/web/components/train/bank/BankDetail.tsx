// The selected position (phase-05 plan §4.3 `BankDetail`; DR/V3MistakeBank `.mbleft`, V3iPadPMistakeBank's top
// section). Desktop and iPad landscape: the static board as large as the column and the viewport allow, under it the
// info grid `.mbinfo` (plan §4.3): the eyebrow ("Due today · White to move"), "{theme} · you played {SAN}", the
// judgement badge with "{Judgement} · vs opp · when · move N · Phase", the mastery dots with "Mastery n of 5 · best
// move hidden until you try" (hidden ≤ 640 px tall, as the board's `.tall`), and the two actions beside them (FIX-2:
// the badge and mastery lines were missing). iPad portrait: a 280 px board beside the text (`compact`), mastery
// included. Phones have no detail pane (a row opens the runner).
//
// The best move is never on this screen ("best move hidden until you try", BankRow is strict on the wire).
// "Solve This One" renders a session-creating page, so it is never prefetched.
import Link from "next/link";
import { Play } from "lucide-react";
import type { BankRow } from "@repo/contracts/http/train";
import { StaticBoard } from "@/components/board/StaticBoard";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { lastMoveSquares } from "../hub/parts";
import { JudgementBadge, MasteryDots } from "./BankRow";
import { detailOf, judgementLabel, rowSubline, seeInGameHref, solveHref } from "./model";

/**
 * The left pane is a size container, so the board takes what the pane can give it: its width, or its height less the
 * info lines under it (four lines beside the actions, three ≤ 640 px tall where the mastery line hides; the actions
 * stack under them at ≤ 1100 px), at most 880 px (DR/V3MistakeBank `.mbb`/`.mbinfo`, which size from 100vh; the
 * pane's own height also covers zoom and the shell's bars).
 */
export const SECTION = "flex min-h-0 flex-col items-center justify-center gap-2.5 [container-type:size] tabbar:hidden";
export const BOARD =
  "w-[max(160px,min(100cqw,calc(100cqh-140px),880px))] shrink-0 vh640:w-[max(160px,min(100cqw,calc(100cqh-116px),880px))] " +
  "narrow:w-[max(160px,min(100cqw,calc(100cqh-196px),880px))] narrow:vh640:w-[max(160px,min(100cqw,calc(100cqh-172px),880px))]";
export const INFO = "w-[min(100cqw,max(680px,min(calc(100cqh-140px),880px)))] vh640:w-[min(100cqw,max(680px,min(calc(100cqh-116px),880px)))]";

export type DetailActions = {
  onSolve?: (row: BankRow) => void;
  onSeeInGame?: (row: BankRow) => void;
};

export function BankDetail({ row, onSolve, onSeeInGame }: { row: BankRow | null } & DetailActions) {
  if (!row) {
    return (
      <section aria-label="Selected position" className={SECTION} data-testid="bank-detail" data-empty="">
        <span aria-hidden="true" className={cn(BOARD, "block aspect-square border border-dashed border-cb-border-dashed")} />
        <p className="m-0 text-overline">No position selected</p>
        <p className="m-0">Clear a filter to see positions again.</p>
      </section>
    );
  }
  const d = detailOf(row);
  return (
    <section aria-label="Selected position" className={SECTION} data-testid="bank-detail">
      <div className={BOARD}>
        <StaticBoard key={row.cardRef} fen={row.fen} orientation={row.orient} lastMove={lastMoveSquares(row.lastMove)} label={d.boardLabel} data-testid="bank-detail-board" />
      </div>
      <div className={cn(INFO, "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 narrow:grid-cols-[minmax(0,1fr)]")}>
        <p className="m-0 text-overline" data-testid="bank-detail-eyebrow">
          {d.eyebrow}
        </p>
        <h2 className="m-0 truncate font-serif text-[1.375rem]/[1.15] font-normal tracking-[-0.01em] text-cb-text vh760:text-lg" data-testid="bank-detail-title">
          {d.title} · <span className="font-mono text-[0.9375rem]">{d.played}</span>
        </h2>
        <p className="m-0 flex min-w-0 items-center gap-2 text-[0.8125rem] text-cb-text-soft" data-testid="bank-detail-meta">
          <JudgementBadge judgement={row.judgement} size={18} />
          <span className="truncate">{d.meta}</span>
        </p>
        <p className="m-0 flex min-w-0 items-center gap-2 vh640:hidden" data-testid="bank-detail-mastery">
          <MasteryDots mastery={row.mastery} />
          <span className="truncate font-mono text-xs text-cb-text-soft">{d.mastery}</span>
        </p>
        <div className="col-start-2 row-span-4 row-start-1 flex flex-col gap-1.5 vh640:row-span-3 narrow:col-start-1 narrow:row-span-1 narrow:row-start-5 narrow:mt-1.5 narrow:flex-row">
          <Link
            href={solveHref(row.cardRef)}
            prefetch={false}
            onClick={() => onSolve?.(row)}
            className={cn(buttonVariants({ size: "lg" }), "min-h-12")}
            data-testid="bank-solve-one"
          >
            <Play aria-hidden="true" />
            Solve This One
          </Link>
          <Link href={seeInGameHref(row)} onClick={() => onSeeInGame?.(row)} className={buttonVariants({ variant: "secondary", size: "lg" })} data-testid="bank-see-in-game">
            See It in Your Game
          </Link>
        </div>
      </div>
    </section>
  );
}

/** iPad portrait: board 280 px beside the text, over the list (V3iPadPMistakeBank). */
export function BankDetailCompact({ row, onSolve }: { row: BankRow | null } & DetailActions) {
  if (!row) return null;
  const d = detailOf(row);
  return (
    <section
      aria-label="Selected position"
      className="hidden grid-cols-[280px_minmax(0,1fr)] items-center gap-4 border-b border-cb-border pt-1 pb-3 tablet-portrait:grid"
      data-testid="bank-detail-compact"
    >
      <StaticBoard key={row.cardRef} fen={row.fen} orientation={row.orient} lastMove={lastMoveSquares(row.lastMove)} label={d.boardLabel} />
      <span className="flex min-w-0 flex-col gap-2">
        <span className="text-overline">{d.eyebrow}</span>
        <span className="font-serif text-2xl/[1.15]">{row.theme.label}</span>
        <span className="flex items-center gap-1.5 text-sm">
          <JudgementBadge judgement={row.judgement} size={16} />
          <span>
            You played <span className="font-mono">{row.playedSan}</span> · {judgementLabel(row.judgement)}
          </span>
        </span>
        <span className="text-xs text-cb-text-soft">{rowSubline(row)}</span>
        <span className="flex items-center gap-2" data-testid="bank-detail-compact-mastery">
          <MasteryDots mastery={row.mastery} />
          <span className="font-mono text-xs text-cb-text-soft">{d.mastery}</span>
        </span>
        <Link href={solveHref(row.cardRef)} prefetch={false} onClick={() => onSolve?.(row)} className={cn(buttonVariants({ variant: "secondary" }), "self-start")}>
          Solve This One
        </Link>
      </span>
    </section>
  );
}
