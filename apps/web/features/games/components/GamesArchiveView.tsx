"use client";

// My games (plan §4.9; DR/V3GamesArchive*.dc.html). The presentational screen: it owns only UI state (the filter
// draft and popover, the search box, the "refreshing" hairline delay) and renders every design state from props, so
// the real route (GamesArchiveScreen: URL + TanStack Query + socket) and the /dev/ui/games demo (fixtures) share it.
//
// States: `loading` (9 ghost rows + aside placeholder), `default`, `filters_open`, `empty` (no games at all),
// `empty` filtered ("No games match 'pawnstorm'."), `error` (Banner + Try Again). `import_running` is P4's.
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { TABBAR_MQ, TABLET_PORTRAIT_MQ } from "@/lib/layout/media-queries";
import { cn } from "@/lib/utils";
import { isSearchShortcut } from "../model/keys";
import { isFiltered, type GamesFilter } from "../model/filter";
import type { GameRowDTO } from "../model/rows";
import { ArchiveHeaderFrame } from "./ArchiveHeaderFrame";
import { AsideSkeleton, GhostRows } from "./ArchiveSkeleton";
import { FilterControl } from "./FilterControl";
import { GameAside } from "./GameAside";
import { GameList } from "./GameList";
import { CARD, GRID, GRID_SINGLE, PAGE } from "./layout";
import { SearchField } from "./SearchField";

/** The hairline over a list that is refetching for a new filter shows only after this delay (plan §5.10). */
export const REFRESH_HAIRLINE_DELAY_MS = 200;

export type ArchivePhase = "loading" | "ready" | "error";

export type GamesArchiveViewProps = {
  filter: GamesFilter;
  /** The search box text (may differ from filter.q while debouncing, or be 1 character). */
  searchText: string;
  onSearchText: (text: string) => void;
  onApplyFilter: (filter: GamesFilter) => void;
  phase: ArchivePhase;
  rows: GameRowDTO[];
  /** A new filter is loading while the previous rows stay (keepPreviousData). */
  refreshing: boolean;
  /** `meta.counts.all` (every finished game); null when unknown. */
  totalAll: number | null;
  hasNext: boolean;
  loadingNext: boolean;
  nextFailed: boolean;
  onLoadNext: () => void;
  onRetryNext: () => void;
  onRetry: () => void;
  /** The popover's draft and its live count (owned by the screen, which runs the count query). */
  draftCount: number | null;
  draftCounting: boolean;
  onDraftChange: (draft: GamesFilter | null) => void;
  selectedRef: string | null;
  onSelect: (ref: string) => void;
  /** Keyboard (Enter, C), double-click or a phone tap: navigate to the review or Compare. */
  onOpen: (row: GameRowDTO, target: "review" | "compare") => void;
  /** The aside's links navigate themselves; this only records the click. */
  onFollow: (row: GameRowDTO, target: "review" | "compare") => void;
  /** Row selection dwell / Open Review hover: prefetch the review route. */
  onIntent?: (row: GameRowDTO) => void;
  reviewHref: (ref: string) => string;
  compareHref: (ref: string) => string;
  /** The empty state's primary. */
  playHref: string;
  /** Demo: open the filter popover on mount (`filters_open`). */
  defaultFiltersOpen?: boolean;
};

export function GamesArchiveView(props: GamesArchiveViewProps) {
  const { filter, phase, rows, refreshing, selectedRef, onSelect, onOpen } = props;
  const listId = `games-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Filter popover + draft. The draft starts as the applied filter each time the popover opens.
  const [filtersOpen, setFiltersOpen] = useState(Boolean(props.defaultFiltersOpen));
  const [draft, setDraft] = useState<GamesFilter>(filter);
  const openFilters = (open: boolean) => {
    setFiltersOpen(open);
    if (open) setDraft(filter);
    props.onDraftChange(open ? filter : null);
  };
  const editDraft = (next: GamesFilter) => {
    setDraft(next);
    props.onDraftChange(next);
  };
  // The demo opens the popover on mount: tell the screen the draft once.
  const announcedDraft = useRef(false);
  useEffect(() => {
    if (announcedDraft.current || !props.defaultFiltersOpen) return;
    announcedDraft.current = true;
    props.onDraftChange(filter);
  }, [props, filter]);

  // The "refreshing" hairline appears only when the refetch takes longer than 200 ms.
  const [hairline, setHairline] = useState(false);
  useEffect(() => {
    if (!refreshing) {
      setHairline(false);
      return;
    }
    const t = setTimeout(() => setHairline(true), REFRESH_HAIRLINE_DELAY_MS);
    return () => clearTimeout(t);
  }, [refreshing]);

  // F focuses the search from anywhere on the page (not inside fields, dialogs or the listbox, which maps it itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isSearchShortcut(e)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectedIndex = selectedRef ? rows.findIndex((r) => r.ref === selectedRef) : -1;
  const selectedRow = selectedIndex >= 0 ? rows[selectedIndex]! : (rows[0] ?? null);
  const listIndex = selectedIndex >= 0 ? selectedIndex : rows.length ? 0 : -1;

  const filtered = isFiltered(filter);
  const noGamesAtAll = phase === "ready" && rows.length === 0 && !filtered && (props.totalAll ?? 0) === 0;
  const noMatches = phase === "ready" && rows.length === 0 && !noGamesAtAll;
  const state =
    phase === "loading"
      ? "loading"
      : phase === "error"
        ? "error"
        : noGamesAtAll
          ? "empty"
          : noMatches
            ? "empty_filtered"
            : filtersOpen
              ? "filters_open"
              : "default";

  const header = (
    <ArchiveHeaderFrame
      search={<SearchField value={props.searchText} onChange={props.onSearchText} inputRef={searchRef} />}
      filter={
        <FilterControl
          applied={filter}
          open={filtersOpen}
          onOpenChange={openFilters}
          draft={draft}
          onDraftChange={editDraft}
          onApply={(next) => {
            setFiltersOpen(false);
            props.onDraftChange(null);
            props.onApplyFilter(next);
          }}
          draftCount={props.draftCount}
          draftCounting={props.draftCounting}
        />
      }
    />
  );

  if (noGamesAtAll) {
    return (
      <div data-rc-lock="" className={PAGE} data-testid="games-archive" data-state={state}>
        {header}
        <div className={GRID_SINGLE}>
          <section aria-label="Games" className={cn(CARD, "flex flex-col")}>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center" data-testid="games-empty">
              <h2 className="font-serif text-[2rem]/[1.1] font-normal tracking-[-0.01em] text-cb-text">No games yet</h2>
              <p className="m-0 max-w-[380px] text-body text-cb-text-soft">
                Play a game and the coach reviews it here.
              </p>
              <Link href={props.playHref} className={buttonVariants({ variant: "primary" })} data-testid="games-empty-play">
                Play a Game
              </Link>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div data-rc-lock="" className={PAGE} data-testid="games-archive" data-state={state}>
      {header}
      <div className={GRID}>
        <section aria-label="Games" className={cn(CARD, "relative flex flex-col")} aria-busy={phase === "loading" || undefined}>
          {hairline ? (
            <span
              aria-hidden="true"
              data-testid="games-refreshing"
              className="absolute top-0 left-0 z-10 h-0.5 animate-rc-hair bg-cb-accent motion-reduce:w-[70%] motion-reduce:animate-none"
            />
          ) : null}
          {phase === "error" ? (
            <Banner
              tone="bad"
              live="assertive"
              className="m-3"
              data-testid="games-error"
              action={
                <Button variant="secondary" size="sm" onClick={props.onRetry}>
                  Try Again
                </Button>
              }
            >
              Couldn’t load your games.
            </Banner>
          ) : null}
          {phase === "loading" ? (
            <>
              <span className="sr-only" role="status">
                Loading your games…
              </span>
              <GhostRows />
            </>
          ) : null}
          {phase === "ready" && noMatches ? (
            <NoMatches
              filter={filter}
              onClearSearch={() => {
                props.onSearchText("");
              }}
              onClearFilters={() => props.onApplyFilter(filter.q ? { q: filter.q } : {})}
            />
          ) : null}
          {phase === "ready" && rows.length > 0 ? (
            <GameList
              listId={listId}
              listRef={listRef}
              rows={rows}
              selectedIndex={listIndex}
              onSelect={(i, via) => {
                const row = rows[i];
                if (!row) return;
                // Phones have no aside: a tap opens the review (iPad portrait keeps select + the strip).
                if (via === "pointer" && isPhoneViewport()) onOpen(row, "review");
                else onSelect(row.ref);
              }}
              onOpen={(i, target) => {
                const row = rows[i];
                if (!row || (target === "compare" && !row.hasComparison)) return;
                onOpen(row, target);
              }}
              onSearchKey={() => searchRef.current?.focus()}
              busy={refreshing}
              hasNext={props.hasNext}
              loadingNext={props.loadingNext}
              nextFailed={props.nextFailed}
              onLoadNext={props.onLoadNext}
              onRetryNext={props.onRetryNext}
            />
          ) : null}
        </section>
        {phase === "loading" ? (
          <AsideSkeleton />
        ) : (
          <GameAside
            row={phase === "ready" ? selectedRow : null}
            reviewHref={props.reviewHref}
            compareHref={props.compareHref}
            onFollow={props.onFollow}
            onIntent={props.onIntent}
          />
        )}
      </div>
    </div>
  );
}

/** A phone-sized viewport (tab-bar mode, not iPad portrait). Read at event time only, never for the first render. */
function isPhoneViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(TABBAR_MQ).matches && !window.matchMedia(TABLET_PORTRAIT_MQ).matches;
}

function NoMatches({
  filter,
  onClearSearch,
  onClearFilters,
}: {
  filter: GamesFilter;
  onClearSearch: () => void;
  onClearFilters: () => void;
}) {
  const hasOtherFilters = Boolean(filter.result?.length || filter.tc?.length || filter.moments);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center" data-testid="games-no-match">
      <h2 className="font-serif text-[1.75rem]/[1.1] font-normal tracking-[-0.01em] text-cb-text">
        {filter.q ? `No games match ‘${filter.q}’.` : "No games match these filters."}
      </h2>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {filter.q ? (
          <Button variant="secondary" onClick={onClearSearch} data-testid="games-clear-search">
            Clear Search
          </Button>
        ) : null}
        {hasOtherFilters ? (
          <Button variant="secondary" onClick={onClearFilters} data-testid="games-clear-filters">
            Clear Filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}
