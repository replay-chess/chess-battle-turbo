"use client";

// /train/weakness and /train/weakness/[pattern] wired (phase-06 plan §4.2, §4.11, §5). The RSC seeds
// `qk.train.weakness()`, so the first paint makes no /api request. After that:
// - push: `weakness:progress` patches the cache, `weakness:ready` refetches it (useWeaknessEvents); without a live
//   socket the query's own fallback poll runs while the profile is building or updating (WP5's hoisted schedule);
// - the drill config: the URL holds the selected pattern (`/train/weakness/{slug}`, pushState, so no RSC request; Back
//   and Esc close it); desktop and iPad L expand the row in place, phones and iPad P open the sheet;
// - tabs (`?tab=`, replaceState), the accordion and "See all" are view state: no request;
// - mutations: Retry / Include bullet (TR-12), the orphaned auto-build (TR-12 once per mount), seen (TR-13 once per
//   version), Start drill (TR-7);
// - the ready flash when this mount watched a build turn ready; a toast when an update changed the top pattern.
import { useEffect, useReducer, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { WeaknessPayload, WeaknessRow } from "@repo/contracts/http/weakness";
import { useRetryCountdown } from "@/components/system/useRetryCountdown";
import { notify } from "@/components/ui/toast";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { initialViewState, viewReducer } from "@/features/train/weakness/view-state";
import { trackWeakness } from "@/features/train/weakness/telemetry";
import { useAutoBuildWeakness } from "@/features/train/weakness/useAutoBuildWeakness";
import { useMarkWeaknessSeen } from "@/features/train/weakness/useMarkWeaknessSeen";
import { useRecomputeWeakness, WITH_BULLET } from "@/features/train/weakness/useRecomputeWeakness";
import { isEmptyDrill, useStartWeaknessDrill } from "@/features/train/weakness/useStartWeaknessDrill";
import { isApiError, shortEventId } from "@/lib/api/errors";
import { useMe } from "@/lib/api/queries/me";
import { useWeaknessQuery } from "@/lib/api/queries/weakness";
import { useWeaknessEvents } from "@/lib/realtime/handlers/weakness";
import { TABBAR_QUERY } from "./classes";
import { copy, type WeaknessTab } from "./copy";
import { drillPreview, type DrillSize } from "./DrillConfig";
import { drillPath, linkedIdle, PROFILE_PATH, rowBySlug, slugFromPath, topChanged } from "./model";
import { focusWeaknessH1 } from "./WeaknessHeader";
import { WeaknessView } from "./WeaknessView";

export type WeaknessEntry = "nav" | "hub" | "home" | "palette" | "chord" | "direct" | "dot";

function tabUrl(tab: WeaknessTab): string {
  const url = new URL(window.location.href);
  if (tab === "phase") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  return `${url.pathname}${url.search}`;
}

/** The nearest scrolling ancestor's top edge (the viewport's 0 when none scrolls). */
function scrollTopEdge(el: HTMLElement): number {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p.getBoundingClientRect().top;
  }
  return 0;
}

/** The row's top edge (its border and header) is above its scroll box's visible top. */
function headerCut(row: HTMLElement): boolean {
  return row.getBoundingClientRect().top < scrollTopEdge(row) - 0.5;
}

export function WeaknessScreen({ initialTab, entry = "direct" }: { initialTab: WeaknessTab; entry?: WeaknessEntry }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: payload } = useWeaknessQuery();
  const { data: me } = useMe();
  const isTrial = me?.entitlement.trial.active ?? false;
  const sheetMode = useMediaQuery(TABBAR_QUERY);
  const [view, dispatch] = useReducer(viewReducer, undefined, () => initialViewState(initialTab, payload.status));

  useWeaknessEvents();

  // ── status transitions: the ready flash, the top-changed toast ──────────────────────────────────────────────
  const status = payload.status;
  useEffect(() => {
    dispatch({ type: "status", status });
  }, [status]);
  const prev = useRef<WeaknessPayload>(payload);
  useEffect(() => {
    const label = topChanged(prev.current, payload);
    prev.current = payload;
    if (label) notify.info(copy.topChanged(label), { id: "weakness:top-changed" });
  }, [payload]);

  // ── telemetry: viewed once per status per visit; computing once per mount ───────────────────────────────────
  const viewed = useRef(new Set<string>());
  useEffect(() => {
    if (viewed.current.has(status)) return;
    viewed.current.add(status);
    const rows = payload.top.length + payload.more.length;
    trackWeakness(
      "weakness_viewed",
      {
        status,
        patterns: rows,
        games_analysed: payload.games.analysed,
        games_in_scope: payload.games.inScope,
        list_mode: status === "ready" ? payload.listMode : null,
        top_pattern: payload.top[0]?.pattern ?? null,
        band_min: payload.band?.min ?? null,
        has_clock: payload.breakdown?.clock != null,
        updating: payload.updating !== null,
        entry,
      },
      isTrial,
    );
    if (status === "computing" && payload.progress) {
      const p = payload.progress;
      trackWeakness("weakness_computing_viewed", { pct: p.pct, eta_sec: p.etaSec, stalled: p.stalled, target: p.target, orphaned: p.orphaned }, isTrial);
    }
  }, [status, payload, entry, isTrial]);

  // ── mutations ───────────────────────────────────────────────────────────────────────────────────────────────
  const recompute = useRecomputeWeakness(isTrial);
  const recomputeLimit = useRetryCountdown(recompute, { routeId: "train.weakness.recompute" });
  const [retried, setRetried] = useState(false);
  useAutoBuildWeakness(payload, isTrial);
  useMarkWeaknessSeen(payload, status !== "computing" && !view.flash, isTrial);

  // ── the drill config (URL-held selection) ───────────────────────────────────────────────────────────────────
  const selectedSlug = slugFromPath(pathname);
  const selected = status === "ready" ? rowBySlug(payload, selectedSlug) : null;
  const [drillState, setDrillState] = useState<{ slug: string | null; size: DrillSize; mix: boolean }>({ slug: null, size: 10, mix: true });
  const size = drillState.slug === selectedSlug ? drillState.size : 10;
  const mix = drillState.slug === selectedSlug ? drillState.mix : true;
  const startRef = useRef<() => void>(() => {});
  const start = useStartWeaknessDrill(isTrial, () => startRef.current());
  const startLimit = useRetryCountdown(start, { routeId: "train.sessions.create" });

  const startDrill = () => {
    if (!selected) return;
    const p = drillPreview(selected, payload.rating, size, mix);
    start.mutate({ pattern: selected.pattern, size, mix: p.mixEff, own: p.own, puzzles: p.puzzles });
  };
  useEffect(() => {
    startRef.current = startDrill;
  });

  // A URL naming a pattern the profile no longer has (an update dropped it) goes back to the profile.
  useEffect(() => {
    if (status === "ready" && selectedSlug && !selected) window.history.replaceState(null, "", PROFILE_PATH);
  }, [status, selectedSlug, selected]);

  const closeDrill = () => {
    if (view.pushed) {
      dispatch({ type: "pushed", pushed: false });
      window.history.back();
    } else {
      window.history.replaceState(null, "", `${PROFILE_PATH}${window.location.search}`);
    }
  };
  const closeRef = useRef(closeDrill);
  useEffect(() => {
    closeRef.current = closeDrill;
  });

  // Back (popstate) after our pushState lands on the profile: the next close must not go back again. FIX-2 (round-2
  // #24): read from the popstate itself, never from the rendered path: the App Router's pathname follows a pushState
  // one render late, so an effect on `selectedSlug` saw "no slug yet, pushed" right after the push and cleared the
  // flag; the next Esc then replaced the entry instead of going back, and the first Back stayed on the profile.
  useEffect(() => {
    const onPop = () => {
      if (!slugFromPath(window.location.pathname)) dispatch({ type: "pushed", pushed: false });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Focus (FIX-1, WCAG 2.4.3): the inline config replaces the Drill link that opened it, so it takes the focus when it
  // opens (a click, Enter, the week plan, or a direct load of /train/weakness/{slug}); when it closes (Esc, the close
  // control, Back) the focus returns to that row's Drill link, else its header. The sheet takes the focus itself on
  // open; FIX-2 (round-2 #23): on close it has no trigger to return to (Radix focuses its trigger ref, here none), so
  // the same rule returns the focus to the row's Drill link.
  const lastInline = useRef<string | null>(null);
  useEffect(() => {
    const slug = selected?.slug ?? null;
    const was = lastInline.current;
    lastInline.current = slug;
    if (slug === was) return;
    // Not cancelled by the effect's cleanup: a payload refetch right after mount re-runs the effect (same slug, so it
    // returns early) and would otherwise drop the pending focus. The frame checks the selection is still this one.
    requestAnimationFrame(() => {
      if (lastInline.current !== slug) return;
      if (slug) {
        if (sheetMode) return;
        const config = document.querySelector<HTMLElement>('[data-testid="weakness-drill-config"]');
        // FIX-2 (round-2 #27): no scroll from the focus itself; the config is scrolled into view, then the selected
        // row's header, so at any zoom the header (and its border) stays in view above the config.
        config?.focus({ preventScroll: true });
        config?.scrollIntoView({ block: "nearest" });
        const pattern = rowBySlug(payload, slug)?.pattern;
        const row = pattern ? document.querySelector<HTMLElement>(`[data-testid="weakness-row"][data-pattern="${CSS.escape(pattern)}"]`) : null;
        if (row && headerCut(row)) row.scrollIntoView({ block: "start" });
        return;
      }
      const pattern = was ? rowBySlug(payload, was)?.pattern : undefined;
      if (!pattern) return;
      const row = document.querySelector<HTMLElement>(`[data-testid="weakness-row"][data-pattern="${CSS.escape(pattern)}"]`);
      (row?.querySelector<HTMLElement>('[data-testid="weakness-drill"], [data-testid="weakness-drill-other"]') ??
        row?.querySelector<HTMLElement>('[data-testid="weakness-row-head"]'))?.focus();
    });
  }, [selected?.slug, sheetMode, payload]);

  // Esc closes the inline config (the sheet closes itself and calls closeDrill).
  useEffect(() => {
    if (!selected || sheetMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, sheetMode]);

  const openDrill = (row: WeaknessRow, from: "row" | "plan") => {
    trackWeakness("weakness_drill_opened", { pattern: row.pattern, rank: row.rank, surface: sheetMode ? "sheet" : "inline", entry: from }, isTrial);
    setDrillState({ slug: row.slug, size: 10, mix: true });
    start.reset();
    const href = `${drillPath(row.slug)}${window.location.search}`;
    if (selectedSlug) {
      window.history.replaceState(null, "", href);
    } else {
      window.history.pushState(null, "", href);
      dispatch({ type: "pushed", pushed: true });
    }
  };

  const configure = (next: { size: DrillSize; mix: boolean }) => {
    if (!selected) return;
    setDrillState({ slug: selected.slug, ...next });
    start.reset();
    trackWeakness("weakness_drill_configured", { pattern: selected.pattern, size: next.size, mix: next.mix }, isTrial);
  };

  const recomputeError = recompute.error;
  const eventId = recomputeError && isApiError(recomputeError) && recomputeError.code !== "rate_limited" ? (shortEventId(recomputeError.requestId) ?? null) : null;

  return (
    <WeaknessView
      payload={payload}
      view={view}
      selectedSlug={selected ? selectedSlug : null}
      sheetMode={sheetMode}
      linked={linkedIdle(me)}
      drill={{
        size,
        mix,
        onSize: (s) => configure({ size: s, mix }),
        onMix: (m) => configure({ size, mix: m }),
        onStart: startDrill,
        onIntent: () => router.prefetch("/train/bank/session"),
        starting: start.isPending || start.isSuccess,
        emptyFromServer: isEmptyDrill(start.error),
        limit: startLimit,
      }}
      recompute={{
        pending: recompute.isPending,
        limit: recomputeLimit,
        failedAgain: retried && status === "failed" && !recompute.isPending,
        eventId,
      }}
      handlers={{
        onToggleRow: (index, row) => {
          if (view.openIndex !== index) trackWeakness("weakness_row_expanded", { pattern: row.pattern, rank: row.rank }, isTrial);
          dispatch({ type: "toggleRow", index });
        },
        onToggleShowAll: () => {
          if (!view.showAll) trackWeakness("weakness_see_all_clicked", { more_count: payload.more.length }, isTrial);
          dispatch({ type: "toggleShowAll" });
        },
        onTab: (tab) => {
          dispatch({ type: "setTab", tab });
          window.history.replaceState(null, "", tabUrl(tab));
          trackWeakness("weakness_tab_changed", { tab }, isTrial);
        },
        onDrill: openDrill,
        onCloseDrill: closeDrill,
        onPlanFollow: (row) => {
          const pattern = payload.top[0]?.pattern ?? payload.more[0]?.pattern;
          if (pattern) trackWeakness("weakness_week_plan_clicked", { kind: row.kind, pattern }, isTrial);
        },
        onSeeProfile: () => {
          dispatch({ type: "dismissFlash" });
          requestAnimationFrame(() => focusWeaknessH1());
        },
        onRetry: () => {
          setRetried(true);
          recompute.mutate({ from: "failed", body: {} });
        },
        onIncludeBullet: () => {
          trackWeakness("weakness_include_bullet_clicked", { bullet_games: payload.offers.includeBullet?.bulletGames ?? 0 }, isTrial);
          recompute.mutate({ from: "bullet_offer", body: { timeClasses: WITH_BULLET } });
        },
        onImport: () => trackWeakness("weakness_import_cta_clicked", { analysed: payload.games.analysed }, isTrial),
        onPlay: () => trackWeakness("weakness_play_cta_clicked", { analysed: payload.games.analysed }, isTrial),
      }}
    />
  );
}
