"use client";

// The aside (DR/V3GamesArchive.dc.html `aside`): the selected game's final position as a static board, "{source} ·
// {tc}", "vs tal_fan_77 · lost", the note line, Open Review (primary) and Compare (legend games only). On iPad
// portrait it is a 200 px strip above the list; phones have no aside (a tap opens the review).
import Link from "next/link";
import { MiniBoard } from "@/components/board/MiniBoard";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { asideHeading, asideNote, asideOverline, finalPositionLabel, type GameRowDTO } from "../model/rows";
import { ASIDE, CARD } from "./layout";

export type GameAsideProps = {
  row: GameRowDTO | null;
  reviewHref: (ref: string) => string;
  compareHref: (ref: string) => string;
  /** A click on Open Review / Compare (the links navigate themselves; this records it). */
  onFollow: (row: GameRowDTO, target: "review" | "compare") => void;
  /** Hover/focus intent on Open Review (router prefetch). */
  onIntent?: (row: GameRowDTO) => void;
};

export function GameAside({ row, reviewHref, compareHref, onFollow, onIntent }: GameAsideProps) {
  if (!row) {
    return (
      <aside aria-label="Selected game" className={cn(CARD, ASIDE)} data-testid="games-aside" data-empty="">
        <div aria-hidden="true" className="aspect-square w-full border border-dashed border-cb-border-dashed tablet-portrait:w-[200px] tablet-portrait:shrink-0" />
        <p className="text-body text-cb-text-soft">Select a game to see its final position.</p>
      </aside>
    );
  }
  return (
    <aside aria-label="Selected game" className={cn(CARD, ASIDE)} data-testid="games-aside" data-ref={row.ref}>
      <MiniBoard
        fen={row.finalFen}
        orientation={row.color}
        size={400}
        label={finalPositionLabel(row)}
        testId="games-aside-board"
        className="block aspect-square h-auto w-full shrink-0 tablet-portrait:w-[200px]"
      />
      <div className="flex min-w-0 flex-col gap-3 tablet-portrait:flex-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-overline">{asideOverline(row)}</p>
          <p className="text-[1.0625rem] font-medium text-cb-text" data-testid="games-aside-heading">
            {asideHeading(row)}
          </p>
          <p className="text-body text-cb-text-soft">{asideNote(row)}</p>
        </div>
        <div className="flex gap-1.5">
          <Link
            href={reviewHref(row.ref)}
            prefetch={false}
            className={cn(buttonVariants({ variant: "primary" }), "flex-auto")}
            data-testid="games-open-review"
            onClick={() => onFollow(row, "review")}
            onMouseEnter={() => onIntent?.(row)}
            onFocus={() => onIntent?.(row)}
          >
            Open Review
          </Link>
          {row.hasComparison ? (
            <Link
              href={compareHref(row.ref)}
              prefetch={false}
              className={buttonVariants({ variant: "secondary" })}
              data-testid="games-open-compare"
              onClick={() => onFollow(row, "compare")}
            >
              Compare
            </Link>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
