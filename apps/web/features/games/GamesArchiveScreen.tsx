"use client";

// /games, wired (plan §5.10): the URL is the state, TanStack Query holds the pages, the socket patches rows.
//
// - Filters/search: `?q=&result=&tc=&moments=1&sel=` through history.replaceState (Next keeps useSearchParams in
//   sync). The search box is local text, debounced 250 ms into the URL; a 1-character search does not filter.
// - A new filter keeps the previous rows (dimmed, aria-busy, a hairline after 200 ms), never a skeleton.
// - The popover's "Show N Games" counts the draft with G1 limit=0, debounced 150 ms (no request while the draft
//   equals the applied filter: page 1 already carries its filteredTotal).
// - Selecting a row writes `?sel=` and, after an 80 ms dwell on a fine pointer, prefetches its review route.
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { COARSE_POINTER_MQ } from "@/lib/layout/media-queries";
import { GamesArchiveView, type ArchivePhase } from "./components/GamesArchiveView";
import { archiveCountsQuery, archiveListQuery, rowsOf, totalsOf } from "./data/archive";
import { useArchiveLive } from "./data/useArchiveLive";
import { archiveSearch, parseArchiveSearch, sameFilter, withSearch, type GamesFilter } from "./model/filter";
import { compareHrefOf, PLAY_HREF, reviewHrefOf } from "./model/hrefs";
import { isAnalysed, type GameRowDTO } from "./model/rows";
import { filteredProps, trackArchive, viewedProps } from "./model/telemetry";

export const SEARCH_DEBOUNCE_MS = 250;
export const COUNT_DEBOUNCE_MS = 150;
export const PREFETCH_DWELL_MS = 80;

/** A value that follows `value` after `ms` of quiet. */
function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

export function GamesArchiveScreen() {
  const router = useRouter();
  const pathname = usePathname() ?? "/games";
  const params = useSearchParams();
  const url = parseArchiveSearch(new URLSearchParams(params?.toString() ?? ""));
  const filter = url.filter;

  const writeUrl = (next: GamesFilter, sel: string | null) => {
    const qs = archiveSearch(next, sel);
    // `null`, never history.state: Next's patched replaceState treats a state that already carries its own markers
    // as an internal call and would not update useSearchParams (the filter and selection would stay stale).
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  };

  // Search box: local text that follows the URL when the URL changes from outside (back/forward, Clear Search).
  const [text, setText] = useState(url.text);
  const [urlText, setUrlText] = useState(url.text);
  if (url.text !== urlText) {
    setUrlText(url.text);
    // Our own debounced write stores the trimmed text: keep what is being typed (a trailing space) in that case.
    if (url.text !== text.trim()) setText(url.text);
  }
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);
  const search = (t: string) => {
    setText(t);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    // Clearing is immediate (Clear Search, the field's ✕); typing waits for the debounce. The filter it edits is
    // read from the URL when the timer fires, so a filter applied in between is kept.
    const apply = () => {
      const current = parseArchiveSearch(new URLSearchParams(window.location.search));
      const next = withSearch(current.filter, t);
      if (!sameFilter(next, current.filter)) writeUrl(next, t === "" ? current.sel : null);
    };
    if (t === "") apply();
    else searchTimer.current = setTimeout(apply, SEARCH_DEBOUNCE_MS);
  };

  const list = useInfiniteQuery(archiveListQuery(filter));
  const rows = rowsOf(list.data);
  const totals = totalsOf(list.data);
  const phase: ArchivePhase = list.data ? "ready" : list.isError ? "error" : "loading";
  const refreshing = list.isPlaceholderData;

  // The popover's draft and its live count.
  const [draft, setDraft] = useState<GamesFilter | null>(null);
  const countedDraft = useDebounced(draft, COUNT_DEBOUNCE_MS);
  const draftIsApplied = draft != null && sameFilter(draft, filter) && !refreshing;
  const counts = useQuery({
    ...archiveCountsQuery(countedDraft ?? {}),
    enabled: countedDraft != null && !(sameFilter(countedDraft, filter) && totals.filtered != null),
  });
  const draftCount = draft == null ? null : draftIsApplied ? totals.filtered : (counts.data ?? null);

  useArchiveLive();

  // Telemetry: the first ready view, then each settled filter change (never the search text itself).
  const viewed = useRef(false);
  const lastTracked = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== "ready" || refreshing) return;
    const key = archiveSearch(filter);
    if (!viewed.current) {
      viewed.current = true;
      lastTracked.current = key;
      trackArchive("games_archive_viewed", viewedProps(filter, totals.filtered ?? rows.length));
      return;
    }
    if (lastTracked.current === key) return;
    lastTracked.current = key;
    trackArchive("games_archive_filtered", filteredProps(filter, totals.filtered ?? rows.length));
  }, [phase, refreshing, filter, totals.filtered, rows.length]);

  // Review prefetch after a short dwell on the selected row (fine pointers only; touch selects by tapping).
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (dwell.current) clearTimeout(dwell.current);
  }, []);
  const intent = (row: GameRowDTO) => {
    if (dwell.current) clearTimeout(dwell.current);
    if (typeof window.matchMedia === "function" && window.matchMedia(COARSE_POINTER_MQ).matches) return;
    dwell.current = setTimeout(() => router.prefetch(reviewHrefOf(row.ref)), PREFETCH_DWELL_MS);
  };

  const follow = (row: GameRowDTO, target: "review" | "compare") =>
    trackArchive("games_archive_game_opened", { analysed: isAnalysed(row), target });

  return (
    <GamesArchiveView
      filter={filter}
      searchText={text}
      onSearchText={search}
      onApplyFilter={(next) => writeUrl(next, null)}
      phase={phase}
      rows={rows}
      refreshing={refreshing}
      totalAll={totals.all}
      hasNext={Boolean(list.hasNextPage)}
      loadingNext={list.isFetchingNextPage}
      nextFailed={list.isFetchNextPageError}
      onLoadNext={() => void list.fetchNextPage()}
      onRetryNext={() => void list.fetchNextPage()}
      onRetry={() => void list.refetch()}
      draftCount={draftCount}
      draftCounting={draft != null && !draftIsApplied && (counts.isFetching || countedDraft !== draft)}
      onDraftChange={setDraft}
      selectedRef={url.sel}
      onSelect={(ref) => {
        writeUrl(filter, ref);
        const row = rows.find((r) => r.ref === ref);
        if (row) intent(row);
      }}
      onOpen={(row, target) => {
        follow(row, target);
        router.push(target === "compare" ? compareHrefOf(row.ref) : reviewHrefOf(row.ref));
      }}
      onFollow={follow}
      onIntent={intent}
      reviewHref={reviewHrefOf}
      compareHref={compareHrefOf}
      playHref={PLAY_HREF}
    />
  );
}
