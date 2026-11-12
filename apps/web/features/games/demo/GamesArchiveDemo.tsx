"use client";

// `/dev/ui/games` (plan §4.10): the real archive screen on fixtures, with no server. The URL is not touched; filters,
// search and selection are local state, filtering runs in memory with the G1 rules, and paging is simulated (the next
// 30 rows after 400 ms), so every design state and every interaction is reachable for the device × zoom suite.
import { useState } from "react";
import { GamesArchiveView } from "../components/GamesArchiveView";
import { withSearch, type GamesFilter } from "../model/filter";
import type { GameRowDTO } from "../model/rows";
import { demoPage, demoRows, type DemoState } from "./fixtures";

export const DEMO_NEXT_PAGE_MS = 400;

export function GamesArchiveDemo({ state, stress, nextError }: { state: DemoState; stress: boolean; nextError: boolean }) {
  const [all] = useState(() => (state === "empty" ? [] : demoRows(stress)));
  const [filter, setFilter] = useState<GamesFilter>({});
  const [text, setText] = useState("");
  const [pages, setPages] = useState(1);
  const [loadingNext, setLoadingNext] = useState(false);
  const [nextFailed, setNextFailed] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<GamesFilter | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">(
    state === "loading" ? "loading" : state === "error" ? "error" : "ready",
  );

  const page = demoPage(all, filter, pages);
  const draftCount = draft ? demoPage(all, draft, 1).total : null;

  const apply = (next: GamesFilter) => {
    setFilter(next);
    setPages(1);
    setNextFailed(false);
  };

  const loadNext = () => {
    if (loadingNext || !page.hasNext) return;
    setLoadingNext(true);
    setTimeout(() => {
      setLoadingNext(false);
      if (nextError) setNextFailed(true);
      else setPages((p) => p + 1);
    }, DEMO_NEXT_PAGE_MS);
  };

  // Demo: record where a row would open in the URL (`opened=review:<ref>`) without leaving the demo state.
  const open = (row: GameRowDTO, target: "review" | "compare") => {
    const url = new URL(window.location.href);
    url.searchParams.set("opened", `${target}:${row.ref}`);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  };

  return (
    <GamesArchiveView
      filter={filter}
      searchText={text}
      onSearchText={(t) => {
        setText(t);
        apply(withSearch(filter, t));
      }}
      onApplyFilter={(f) => {
        if (!f.q) setText("");
        apply(f);
      }}
      phase={phase}
      rows={phase === "ready" ? page.rows : []}
      refreshing={false}
      totalAll={all.length}
      hasNext={page.hasNext}
      loadingNext={loadingNext}
      nextFailed={nextFailed}
      onLoadNext={loadNext}
      onRetryNext={() => {
        setNextFailed(false);
        setPages((p) => p + 1);
      }}
      onRetry={() => setPhase("ready")}
      draftCount={draftCount}
      draftCounting={false}
      onDraftChange={setDraft}
      selectedRef={sel}
      onSelect={setSel}
      onOpen={open}
      onFollow={open}
      reviewHref={(ref) => `#opened-review-${ref}`}
      compareHref={(ref) => `#opened-compare-${ref}`}
      playHref="#play"
      defaultFiltersOpen={state === "filters_open"}
    />
  );
}
