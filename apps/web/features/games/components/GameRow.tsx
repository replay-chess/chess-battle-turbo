"use client";

// One archive row (DR/V3GamesArchive.dc.html `.grow`): result word, opponent and rating over the note, the opening
// or position with the time control (wide only), the date label and the rating delta. A listbox option: focus stays
// on the listbox (aria-activedescendant), so the row itself is not focusable.
//
// The option's name is its content (WCAG 2.5.3 Label in Name, FIX-1): an aria-label that reworded the visible text
// ("Win vs Engine 1400 (1400), …") failed axe's label-content-name-mismatch. Screen-reader-only joiners (" vs ",
// the rating's brackets, commas) make the content read as a sentence: "WIN vs Engine 1400 (1400), Analysing…,
// Italian Game · Rapid 10+0, Today, rating +8". The context cell is wide-only, so it leaves the name with the cell.
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { contextLine, ratingDeltaLabel, resultTone, resultWord, rowNote, type GameRowDTO } from "../model/rows";
import { ROW_GRID, WIDE_ONLY } from "./layout";

const TONE_CLASS = {
  good: "text-cb-good border-cb-good",
  bad: "text-cb-bad border-cb-bad",
  neutral: "text-cb-text-soft border-cb-text-soft",
} as const;

export function gameOptionId(listId: string, ref: string): string {
  return `${listId}-${ref}`;
}

export type GameRowProps = {
  row: GameRowDTO;
  id: string;
  selected: boolean;
  index: number;
  onPick: (index: number) => void;
  onOpen: (index: number) => void;
  /** Virtualiser measurement hook (the row's own height). */
  measureRef?: (el: HTMLElement | null) => void;
  style?: React.CSSProperties;
};

export function GameRow({ row, id, selected, index, onPick, onOpen, measureRef, style }: GameRowProps) {
  const note = rowNote(row);
  return (
    <div
      id={id}
      ref={measureRef}
      role="option"
      aria-selected={selected}
      data-index={index}
      data-ref={row.ref}
      data-testid="games-row"
      data-status={row.analysisStatus}
      style={style}
      onClick={() => onPick(index)}
      onDoubleClick={() => onOpen(index)}
      className={cn(
        ROW_GRID,
        "cursor-pointer border-b border-cb-border text-body text-cb-text select-none [-webkit-tap-highlight-color:transparent] hover:bg-cb-fill",
        selected && "bg-cb-fill group-focus-visible/list:outline-2 group-focus-visible/list:-outline-offset-2 group-focus-visible/list:outline-cb-text",
      )}
    >
      <span
        className={cn(
          "justify-self-start border px-1.5 py-0.5 font-mono text-label leading-[1.3] font-medium tracking-[0.12em]",
          TONE_CLASS[resultTone(row.result)],
        )}
      >
        {resultWord(row.result)}
        <span className="sr-only"> vs </span>
      </span>
      <span className="flex min-w-0 flex-col leading-[1.35]">
        <span className="truncate">
          {row.opponent.name}
          {row.opponent.rating != null ? (
            <>
              <span className="sr-only"> (</span>
              <span className="ml-1.5 font-mono text-xs text-cb-text-soft">{row.opponent.rating}</span>
              <span className="sr-only">)</span>
            </>
          ) : null}
        </span>
        <span
          className="flex min-w-0 items-center gap-1.5 text-sm text-cb-text-soft"
          data-testid="games-row-note"
          data-note={note.kind}
        >
          {note.busy ? <Spinner size="sm" /> : null}
          <span className="truncate">
            <span className="sr-only">, </span>
            {note.text}
          </span>
        </span>
      </span>
      <span className={cn("truncate text-sm text-cb-text-soft", WIDE_ONLY)}>
        <span className="sr-only">, </span>
        {contextLine(row)}
      </span>
      <span className="truncate text-sm text-cb-text-soft">
        <span className="sr-only">, </span>
        {row.playedAtLabel}
      </span>
      {row.ratingDelta == null ? (
        <span aria-hidden="true" className="text-right font-mono text-ui text-cb-text-soft">
          {ratingDeltaLabel(null)}
        </span>
      ) : (
        <span className="text-right font-mono text-ui text-cb-text-soft">
          <span className="sr-only">, rating </span>
          {ratingDeltaLabel(row.ratingDelta)}
        </span>
      )}
    </div>
  );
}
