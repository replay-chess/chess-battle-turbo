"use client";

// The Mistake Bank (phase-05 plan §4.3; DR/V3MistakeBank, V3BankEmpty, V3BankCaughtUp, V3BankLoading and the iPhone,
// Android, iPad L and iPad P MistakeBank and Bank boards). Presentational: it owns UI state only (the filter surface's
// open flag, row focus, the "refreshing" hairline delay); the route (BankScreen: URL, TanStack Query, socket) and the
// /dev/ui/train/bank demo (fixtures) feed it.
//
// One viewport (lock mode): only the list scrolls. Desktop: header (h1, due / bank / next-batch tags, Train, the CTA),
// board + info on the left, the list panel (Due · n / All · n, count, Filter; grouped rows; footer) on the right.
// iPad landscape: the same two panes (rail). iPad portrait: the compact detail over the list, the CTA sticky above
// the tab bar. Phones: tags, the tab row with Filter, the list (a row opens the runner), the sticky CTA.
//
// Keys (desktop, page-scoped, never inside fields or dialogs): ↑/↓ move the selection, Enter solves it, F opens Filter,
// Esc closes it (the surface's own Esc).
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { BankPage, BankRow } from "@repo/contracts/http/train";
import { ScrollRegion } from "@/components/layout/ScrollRegion";
import { ShellBackOverride } from "@/components/shell/back-override";
import { TopBarTitle } from "@/components/shell/TopBarTitle";
import { RetryCountdown } from "@/components/system/RetryCountdown";
import type { RetryCountdownState } from "@/components/system/useRetryCountdown";
import { Button, buttonVariants } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Tag } from "@/components/ui/tag";
import { isEditableTarget, MODAL_OPEN_SELECTOR } from "@/lib/shell/key-target";
import { BANK_SHORTCUTS, registerPageShortcuts } from "@/lib/shell/shortcuts";
import { cn } from "@/lib/utils";
import { BankDetail, BankDetailCompact } from "./BankDetail";
import { BankFilter } from "./BankFilter";
import { BankRowButton } from "./BankRow";
import { CaughtUp, EmptyBank } from "./BankStates";
import {
  bankHref,
  bodyOf,
  caughtUpOf,
  clearedFilters,
  countLabel,
  ctaOf,
  footerOf,
  groupRows,
  headerTags,
  isFiltered,
  nextBatchTag,
  poolOf,
  selectedRowOf,
  solveHref,
  viewOf,
  visibleRowsOf,
  type BankCta,
  type BankFilterState,
  type BankView as BankTab,
} from "./model";

const BankRowMenu = lazy(() => import("./BankRowMenu").then((m) => ({ default: m.BankRowMenu })));

/** The hairline over a list that refetches for a new filter shows only after this delay (cdl §3.9). */
export const REFRESH_HAIRLINE_DELAY_MS = 200;
/** Phones' Due tab previews this many later rows before "Browse All" (V3iPhoneBank `due`). */
export const LATER_PREVIEW_ROWS = 5;

export type BankViewProps = {
  page: BankPage;
  /** Rows the cache holds for the active list: the whole bank when `complete`, else the server pages of the filter. */
  rows: BankRow[];
  complete: boolean;
  filter: BankFilterState;
  sel: string | null;
  /** `nextBatch.at`'s day word ("tomorrow"). */
  nextDay: string | null;
  onFilter: (next: BankFilterState) => void;
  onSelect: (cardRef: string) => void;
  /** Phones: a row tap opens the runner at that card. */
  onOpenRow: (row: BankRow) => void;
  onStart: (cta: Exclude<BankCta, { kind: "none" }>) => void;
  starting: boolean;
  startLimit?: RetryCountdownState;
  /** A new filter's first page is loading while the previous rows stay (keepPreviousData). */
  refreshing?: boolean;
  hasNext?: boolean;
  loadingNext?: boolean;
  onLoadNext?: () => void;
  filterOpen: boolean;
  onFilterOpenChange: (open: boolean) => void;
  /** "Show n Positions" pressed (the screen records `bank_filter_applied`). */
  onFilterShown?: (results: number | null) => void;
  /** `bank-remove`: the row ⋯ menu with Remove From Bank. */
  removable?: boolean;
  onRemove?: (row: BankRow) => void;
  onSolve?: (row: BankRow) => void;
  onSeeInGame?: (row: BankRow) => void;
};

const PHONE_MQ = "(max-width: 600px)";

export function BankView(props: BankViewProps) {
  const { page, rows, complete, filter, sel, nextDay, onFilter, onSelect } = props;
  const body = bodyOf(page, filter);
  const tab: BankTab = viewOf(filter);
  // Complete bank: every tab and filter runs here. Large bank: the server already filtered the rows.
  const pool = complete ? poolOf(rows, filter) : rows;
  const visible = complete ? visibleRowsOf(rows, filter) : rows;
  const selected = selectedRowOf(visible, sel);
  const groups = groupRows(visible, tab);
  const cta = ctaOf(pool, visible);
  const tags = headerTags(page);
  const batch = nextBatchTag(page.nextBatch, nextDay);
  const filtered = isFiltered(filter);
  const dueCount = complete ? pool.filter((r) => r.isDue).length : filtered ? null : page.counts.due;
  const allCount = complete ? pool.length : filtered ? null : page.counts.all;
  const laterPreview = tab === "due" && complete ? pool.filter((r) => !r.isDue).slice(0, LATER_PREVIEW_ROWS) : [];
  const laterTotal = complete ? pool.filter((r) => !r.isDue).length : 0;
  const state = body === "list" ? (filtered ? "filtered" : tab === "due" ? "due" : "default") : body;

  // Row buttons by card, for the arrow keys.
  const rowEls = useRef(new Map<string, HTMLButtonElement>());

  // The hairline over a list refetching for a new filter appears only after 200 ms.
  const [hairline, setHairline] = useState(false);
  useEffect(() => {
    if (!props.refreshing) {
      setHairline(false);
      return;
    }
    const t = setTimeout(() => setHairline(true), REFRESH_HAIRLINE_DELAY_MS);
    return () => clearTimeout(t);
  }, [props.refreshing]);

  // Page keys (desktop): ↑/↓ select, Enter solves the selection, F opens Filter. The `?` list shows their rows while
  // the bank is mounted (WP-G request to WP-F, applied at integration).
  useEffect(() => registerPageShortcuts("bank", BANK_SHORTCUTS), []);
  const keyState = useRef({ visible, selected, body });
  useEffect(() => {
    keyState.current = { visible, selected, body };
  });
  const { onFilterOpenChange } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (isEditableTarget(e.target) || document.querySelector(MODAL_OPEN_SELECTOR)) return;
      if (window.matchMedia(PHONE_MQ).matches) return;
      const { visible: list, selected: cur, body: b } = keyState.current;
      if (b !== "list") return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        onFilterOpenChange(true);
        return;
      }
      if (!list.length) return;
      const at = cur ? list.findIndex((r) => r.cardRef === cur.cardRef) : -1;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const target = e.target as HTMLElement | null;
        // Arrows inside the Due/All radio group belong to it.
        if (target?.closest('[role="radiogroup"], [role="menu"]')) return;
        e.preventDefault();
        const next = list[Math.max(0, Math.min(list.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))]!;
        onSelect(next.cardRef);
        const el = rowEls.current.get(next.cardRef);
        el?.focus({ preventScroll: true });
        el?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Enter" && cur) {
        const target = e.target as HTMLElement | null;
        // Enter on another control activates that control.
        if (target && target !== document.body && !target.closest('[data-testid="bank-row"]')) return;
        e.preventDefault();
        window.location.assign(solveHref(cur.cardRef));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSelect, onFilterOpenChange]);

  // Infinite scroll (large banks): a sentinel 600 px before the end fetches the next page.
  const sentinel = useRef<HTMLLIElement | null>(null);
  const { hasNext, loadingNext, onLoadNext } = props;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNext || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting) && !loadingNext) onLoadNext?.();
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNext, loadingNext, onLoadNext]);

  const pick = (row: BankRow) => {
    if (window.matchMedia(PHONE_MQ).matches) props.onOpenRow(row);
    else onSelect(row.cardRef);
  };

  const ctaButton = (className?: string, testId = "bank-cta") =>
    cta.kind === "none" ? null : (
      <Button
        loading={props.starting}
        onClick={() => {
          if (!props.startLimit?.limited) props.onStart(cta);
        }}
        className={className}
        data-testid={testId}
        {...(props.startLimit?.controlProps ?? {})}
      >
        {cta.label}
      </Button>
    );

  const tabItems = [
    { value: "due" as const, label: dueCount === null ? "Due" : `Due · ${dueCount}` },
    { value: "all" as const, label: allCount === null ? "All" : `All · ${allCount}` },
  ];

  const renderRow = (row: BankRow) => (
    <li key={row.cardRef} className="flex items-stretch border-b border-cb-border">
      <BankRowButton
        row={row}
        current={selected?.cardRef === row.cardRef}
        onPick={pick}
        buttonRef={(el) => {
          if (el) rowEls.current.set(row.cardRef, el);
          else rowEls.current.delete(row.cardRef);
        }}
      />
      {props.removable && props.onRemove ? (
        <Suspense fallback={<span className="w-12 shrink-0" />}>
          <BankRowMenu row={row} onRemove={props.onRemove} />
        </Suspense>
      ) : null}
    </li>
  );

  // Desktop and iPad landscape header. Empty: the title alone; caught up: "0 due", the bank size, the next day.
  const header = (
    <header className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center gap-3 tabbar:hidden" data-testid="bank-header">
      <h1
        className={cn(
          "m-0 font-serif font-normal tracking-[-0.01em] text-cb-text",
          body === "list" ? "text-[clamp(1.75rem,3.6vh,2.25rem)]/[1.05]" : "text-[clamp(2rem,4.9vh,3rem)]/[1.05]",
        )}
      >
        Mistake Bank
      </h1>
      {body === "list" ? (
        <>
          <Tag tone={page.counts.due > 0 ? "ink" : "neutral"} data-testid="bank-tag-due">
            {tags.due}
          </Tag>
          <Tag data-testid="bank-tag-total">{tags.total}</Tag>
          {batch ? <Tag className="vh640:hidden">{batch}</Tag> : null}
        </>
      ) : body === "caughtup" ? (
        <>
          <Tag data-testid="bank-tag-due">{`${page.counts.due} due`}</Tag>
          <Tag data-testid="bank-tag-total">{tags.total}</Tag>
          {page.nextBatch ? <Tag>{`Next batch ${nextDay ?? page.nextBatch.atLabel}`}</Tag> : null}
        </>
      ) : null}
      <span className="flex-auto" />
      <Link href="/train" className={buttonVariants({ variant: "secondary" })} data-testid="bank-train-link">
        <ChevronLeft aria-hidden="true" />
        Train
      </Link>
      {body === "list" ? ctaButton() : null}
    </header>
  );

  return (
    <div
      data-rc-lock=""
      className="flex h-full min-h-0 flex-col gap-4 px-8 pt-6 pb-6 narrow:px-5 vh760:gap-2.5 vh760:px-6 vh760:py-3.5 tabbar:gap-2 tabbar:px-0 tabbar:pt-1 tabbar:pb-0"
      data-testid="train-bank"
      data-state={state}
      data-complete={complete ? "" : undefined}
    >
      <TopBarTitle>
        <span className="text-overline text-cb-text">Mistake Bank</span>
      </TopBarTitle>
      <ShellBackOverride target={{ key: "train", href: "/train", label: "Train" }} />

      {/* Desktop and iPad landscape header (with the list) or the page's centred column (empty, caught up). */}
      {body === "list" ? header : null}
      {/* Tab-bar mode: the h1 is the top bar's title; tags under it. */}
      <div className="hidden flex-wrap gap-1.5 px-4 tabbar:flex tablet-portrait:px-6">
        <h1 className="sr-only">Mistake Bank</h1>
        <Tag tone={page.counts.due > 0 ? "ink" : "neutral"}>{tags.due}</Tag>
        {body === "list" ? null : <Tag>{tags.total}</Tag>}
        {page.nextBatch ? <Tag>{nextDay ? `Next batch ${nextDay}` : `Next batch ${page.nextBatch.atLabel}`}</Tag> : null}
      </div>

      {body === "list" ? (
        <div className="mx-auto grid min-h-0 w-full max-w-[1280px] flex-1 grid-cols-[minmax(0,1fr)_440px] gap-5 vh760:grid-cols-[minmax(0,1fr)_360px] vh760:gap-4 rail:grid-cols-[minmax(0,1fr)_400px] tabbar:flex tabbar:flex-col tabbar:gap-2">
          <BankDetail row={selected} onSolve={props.onSolve} onSeeInGame={props.onSeeInGame} />
          <section
            aria-label="Positions in your bank"
            className="relative flex min-h-0 flex-col border border-cb-border bg-cb-surface tabbar:flex-1 tabbar:border-0 tabbar:bg-transparent"
            data-testid="bank-list-panel"
          >
            <div className="hidden px-6 tablet-portrait:block">
              <BankDetailCompact row={selected} onSolve={props.onSolve} />
            </div>
            {/* Wraps on a narrow phone at 150 % (262 px): the count and Filter move under the tabs instead of off-screen (FIX-1). */}
            <div className="relative flex shrink-0 flex-wrap items-center gap-2 border-b border-cb-border px-3 py-2.5 tabbar:px-4 tablet-portrait:px-6">
              <Segmented<BankTab>
                aria-label="Show"
                value={tab}
                onValueChange={(v) => onFilter({ ...filter, view: v })}
                items={tabItems}
                data-testid="bank-tabs"
              />
              <span className="ml-auto font-mono text-xs whitespace-nowrap text-cb-text-soft" data-testid="bank-count">
                {countLabel(visible.length, tab)}
              </span>
              <BankFilter
                filter={filter}
                facets={page.facets}
                onChange={onFilter}
                results={complete ? visible.length : null}
                open={props.filterOpen}
                onOpenChange={onFilterOpenChange}
                onShow={() => {
                  props.onFilterShown?.(complete ? visible.length : null);
                  onFilterOpenChange(false);
                }}
              />
              {hairline ? <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 animate-rc-hair bg-cb-accent" /> : null}
            </div>
            <ScrollRegion label="Positions" className={cn("min-h-0 flex-1 tabbar:px-4 tablet-portrait:px-6", props.refreshing && "opacity-60")} data-testid="bank-list">
              {groups.map((g) => (
                <div key={g.id} data-group={g.id}>
                  {g.header ? (
                    <h2 className="sticky top-0 z-[2] m-0 border-b border-cb-border bg-cb-fill px-3 py-1.5 text-overline tabbar:-mx-4 tabbar:px-4 tablet-portrait:-mx-6 tablet-portrait:px-6">
                      {g.header}
                    </h2>
                  ) : null}
                  <ul className="m-0 list-none p-0">
                    {g.rows.map(renderRow)}
                    {g.id === groups[groups.length - 1]!.id && hasNext ? <li ref={sentinel} aria-hidden="true" className="h-px" /> : null}
                  </ul>
                </div>
              ))}
              {props.loadingNext ? (
                <p role="status" className="m-0 px-3 py-3 text-ui text-cb-text-soft">
                  Loading more positions…
                </p>
              ) : null}
              {visible.length === 0 ? (
                <div className="flex flex-col items-start gap-2 px-4 py-6" data-testid="bank-no-matches">
                  {filtered ? (
                    <>
                      <p className="m-0 font-medium">Nothing matches these filters</p>
                      <Button variant="secondary" onClick={() => onFilter(clearedFilters(filter))}>
                        Clear Filters
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="m-0 font-medium">Nothing is due right now</p>
                      <Button variant="secondary" onClick={() => onFilter({ ...filter, view: "all" })}>
                        Show All Positions
                      </Button>
                    </>
                  )}
                </div>
              ) : null}
              {/* Phones and iPad portrait, Due tab: a few later rows and the way to all of them (V3iPhoneBank `due`). */}
              {laterPreview.length ? (
                <div className="hidden tabbar:block" data-testid="bank-later-preview">
                  <h2 className="m-0 pt-3 pb-1.5 text-overline">{`Scheduled later · ${laterTotal}`}</h2>
                  <ul className="m-0 list-none border-t border-cb-border p-0">{laterPreview.map(renderRow)}</ul>
                  <Button
                    variant="text"
                    className="my-2 w-full justify-center"
                    onClick={() => onFilter({ ...filter, view: "all" })}
                    data-testid="bank-browse-all"
                  >
                    {`Browse All ${page.counts.all} Positions`}
                  </Button>
                </div>
              ) : null}
            </ScrollRegion>
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-[41px] h-9 bg-linear-to-b from-transparent to-cb-surface tabbar:hidden" />
            <p className="m-0 min-h-[41px] shrink-0 border-t border-cb-border px-3.5 py-2.5 text-xs text-cb-text-soft tabbar:hidden" data-testid="bank-footer">
              {footerOf(page, tab, nextDay)}
            </p>
          </section>
        </div>
      ) : (
        <ScrollRegion label="Mistake Bank" className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] items-center-safe tabbar:items-start tabbar:px-4 tabbar:pt-2 tablet-portrait:px-6">
          <div className="flex flex-col gap-5 tabbar:gap-0">
            {header}
            {body === "empty" ? (
              <EmptyBank page={page} />
            ) : (
              <CaughtUp page={page} model={caughtUpOf(page, nextDay)} browseHref={bankHref({ ...filter, view: "all", sel: null })} onBrowse={() => onFilter({ ...filter, view: "all" })} />
            )}
          </div>
        </ScrollRegion>
      )}

      {/* Tab-bar mode: the primary action sticks above the tab bar. */}
      <div className="hidden shrink-0 border-t border-cb-border bg-cb-bg px-4 pt-2 pb-2 tabbar:grid tablet-portrait:px-6" data-testid="bank-sticky-cta">
        {body === "list" ? (
          ctaButton("w-full", "bank-sticky-cta-button")
        ) : body === "empty" ? (
          <Link href="/play" className={cn(buttonVariants({ size: "lg" }), "w-full")}>
            Play a Game to Fill Your Bank
          </Link>
        ) : (
          <Link
            href={`/train/puzzles?theme=${encodeURIComponent(page.focusTheme.key)}&source=bank`}
            prefetch={false}
            className={cn(buttonVariants({ size: "lg" }), "w-full")}
          >
            {`Train ${page.focusTheme.label} While You Wait`}
          </Link>
        )}
      </div>
      {props.startLimit ? <RetryCountdown countdown={props.startLimit} className="px-4" /> : null}
    </div>
  );
}
