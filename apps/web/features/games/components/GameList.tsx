"use client";

// The virtualised archive listbox (plan §4.9, §5.10; Appendix A keeps @tanstack/react-virtual eager at every size).
//
// - role="listbox" is the scroll container and the only tab stop; rows are options addressed by
//   aria-activedescendant, so ↑/↓/Home/End/PageUp/PageDown move the selection without moving focus.
// - Paging: a sentinel after the last row is observed with a 600 px root margin; when it is near and another page
//   exists, the next page loads. A failed next page leaves an inline "Couldn't load more · Try Again" row.
// - "use no memo": TanStack Virtual's instance is stable and mutates on scroll, so a compiled component would keep
//   the first getVirtualItems() result. This component opts out of the React Compiler; nothing else in the feature does.
import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { listKeyAction, type ListAction } from "../model/keys";
import type { GameRowDTO } from "../model/rows";
import { GameRow, gameOptionId } from "./GameRow";

/** Row height of the board (`.grow` min-height 56 px); rows are measured, so the 48 px short-viewport rows work too. */
export const ROW_ESTIMATE_PX = 56;
/** IntersectionObserver root margin of the next-page sentinel (plan §5.10). */
export const NEXT_PAGE_MARGIN = "600px";

export type GameListProps = {
  listId: string;
  rows: GameRowDTO[];
  selectedIndex: number;
  /** A keyboard move or a row click (`via` lets phones open on tap). */
  onSelect: (index: number, via: "key" | "pointer") => void;
  onOpen: (index: number, target: "review" | "compare") => void;
  onSearchKey: () => void;
  /** keepPreviousData while a new filter loads: rows dim, aria-busy. */
  busy: boolean;
  hasNext: boolean;
  loadingNext: boolean;
  nextFailed: boolean;
  onLoadNext: () => void;
  onRetryNext: () => void;
  listRef?: React.Ref<HTMLDivElement>;
};

export function GameList({
  listId,
  rows,
  selectedIndex,
  onSelect,
  onOpen,
  onSearchKey,
  busy,
  hasNext,
  loadingNext,
  nextFailed,
  onLoadNext,
  onRetryNext,
  listRef,
}: GameListProps) {
  "use no memo";
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const nearEnd = useRef(false);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 8,
    getItemKey: (i) => rows[i]?.ref ?? i,
  });

  // Keep the selected row rendered and in view (keyboard moves, ?sel= on load).
  useEffect(() => {
    if (selectedIndex >= 0 && selectedIndex < rows.length) virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, rows.length, virtualizer]);

  // Next page: the sentinel within 600 px of the viewport of the list.
  useEffect(() => {
    const root = scrollRef.current;
    const target = sentinelRef.current;
    if (!root || !target || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        nearEnd.current = entries.some((e) => e.isIntersecting);
        if (nearEnd.current && hasNext && !loadingNext && !nextFailed) onLoadNext();
      },
      { root, rootMargin: `0px 0px ${NEXT_PAGE_MARGIN} 0px` },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [hasNext, loadingNext, nextFailed, onLoadNext]);

  // A short page leaves the sentinel in range: the observer does not fire again, so load the next one here.
  useEffect(() => {
    if (nearEnd.current && hasNext && !loadingNext && !nextFailed) onLoadNext();
  }, [rows.length, hasNext, loadingNext, nextFailed, onLoadNext]);

  const items = virtualizer.getVirtualItems();
  const total = virtualizer.getTotalSize();
  const active = selectedIndex >= 0 && selectedIndex < rows.length ? rows[selectedIndex] : undefined;

  const apply = (action: ListAction) => {
    if (!action) return false;
    if (action.type === "move") onSelect(action.index, "key");
    else if (action.type === "open") onOpen(selectedIndex, action.target);
    else onSearchKey();
    return true;
  };

  return (
    <div
      ref={(el) => {
        scrollRef.current = el;
        if (typeof listRef === "function") listRef(el);
        else if (listRef) (listRef as React.RefObject<HTMLDivElement | null>).current = el;
      }}
      id={listId}
      role="listbox"
      aria-label="Games"
      aria-busy={busy || undefined}
      aria-activedescendant={active ? gameOptionId(listId, active.ref) : undefined}
      tabIndex={0}
      data-rc-scroll=""
      data-testid="games-list"
      onKeyDown={(e) => {
        const canCompare = Boolean(active?.hasComparison);
        if (apply(listKeyAction(e, selectedIndex, rows.length, canCompare))) e.preventDefault();
      }}
      className={cn(
        "group/list relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain outline-none [scrollbar-gutter:stable] [scrollbar-width:thin] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cb-text",
        busy && "[&_[role=option]]:opacity-60",
      )}
    >
      <div className="relative w-full" style={{ height: total }}>
        {items.map((item) => {
          const row = rows[item.index]!;
          return (
            <GameRow
              key={item.key}
              row={row}
              id={gameOptionId(listId, row.ref)}
              index={item.index}
              selected={item.index === selectedIndex}
              onPick={(i) => onSelect(i, "pointer")}
              onOpen={(i) => onOpen(i, "review")}
              measureRef={virtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}
            />
          );
        })}
      </div>
      <div ref={sentinelRef} data-testid="games-list-end" className="min-h-px">
        {loadingNext ? (
          <div role="status" className="flex min-h-14 items-center justify-center gap-2 text-sm text-cb-text-soft">
            <Spinner size="sm" />
            Loading more games…
          </div>
        ) : nextFailed ? (
          <div role="alert" className="flex min-h-14 items-center justify-center gap-2 text-sm text-cb-text-soft" data-testid="games-next-error">
            <span>Couldn’t load more</span>
            <span aria-hidden="true">·</span>
            <Button variant="text" size="sm" onClick={onRetryNext}>
              Try Again
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
