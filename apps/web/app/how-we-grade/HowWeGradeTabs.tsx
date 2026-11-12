"use client";

// The How we grade tabs (plan §4.5; DR/V3HowWeGrade.dc.html `.vt`): a vertical tablist in the left column on desktop
// and iPad landscape; a segmented row above the panel on iPad portrait and phones. Arrow keys move between tabs
// (roving tabindex, automatic activation). `?tab=` and the hash stay in the URL: `#blunder` opens Move Labels and
// scrolls to the row, `#failures` opens Accuracy and scrolls to that section. The page is static, so the URL is read
// once after hydration.
import { useEffect, useState } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { TABBAR_MQ } from "@/lib/layout/media-queries";
import { trackArchive } from "@/features/games/model/telemetry";
import { cn } from "@/lib/utils";
import { HWG_TABS, TAB_LABEL, tabOfAnchor, type HwgTab } from "./content";

type From = "review" | "game_over" | "nav" | "deeplink" | "pricing";
const FROM: readonly From[] = ["review", "game_over", "nav", "deeplink", "pricing"];

/** Where the visitor came from: `?from=`, else the same-site referrer's path, else a deep link. */
export function viewSource(search: URLSearchParams, referrer: string, origin: string): From {
  const explicit = search.get("from");
  if (explicit && (FROM as readonly string[]).includes(explicit)) return explicit as From;
  if (!referrer) return "deeplink";
  let ref: URL;
  try {
    ref = new URL(referrer);
  } catch {
    return "deeplink";
  }
  if (ref.origin !== origin) return "deeplink";
  const p = ref.pathname;
  if (p === "/review" || p.startsWith("/review/")) return "review";
  if (p.startsWith("/game/")) return "game_over";
  if (p === "/pricing" || p.startsWith("/pricing/")) return "pricing";
  return "nav";
}

/** Scrolls to an anchor once the panel that holds it has rendered. */
function scrollToAnchor(anchor: string): void {
  requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" })));
}

function isTab(v: string | null): v is HwgTab {
  return v != null && (HWG_TABS as readonly string[]).includes(v);
}

export function HowWeGradeTabs({
  intro,
  footnote,
  panels,
}: {
  /** h1 + lead (server-rendered). */
  intro: React.ReactNode;
  /** The engine and attribution lines (hidden on short viewports). */
  footnote: React.ReactNode;
  panels: Record<HwgTab, React.ReactNode>;
}) {
  const [tab, setTab] = useState<HwgTab>("labels");
  const segmented = useMediaQuery(TABBAR_MQ);

  // Once, after hydration: the tab from ?tab= or the hash, the scroll to the anchor, and the view event.
  useEffect(() => {
    const url = new URL(window.location.href);
    const anchor = decodeURIComponent(url.hash.replace(/^#/, ""));
    const fromHash = anchor ? tabOfAnchor(anchor) : null;
    const fromQuery = url.searchParams.get("tab");
    const initial: HwgTab = fromHash ?? (isTab(fromQuery) ? fromQuery : "labels");
    setTab(initial);
    trackArchive("how_we_grade_viewed", {
      tab: initial,
      from: viewSource(url.searchParams, document.referrer, window.location.origin),
    });
    if (anchor && fromHash) scrollToAnchor(anchor);
    // In-page links to an anchor (`#failures` from a review, `#blunder` from a badge) switch the tab too.
    const onHash = () => {
      const next = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      const target = next ? tabOfAnchor(next) : null;
      if (!target) return;
      setTab(target);
      scrollToAnchor(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const change = (value: string) => {
    if (!isTab(value)) return;
    setTab(value);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    url.hash = "";
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    trackArchive("how_we_grade_viewed", { tab: value, from: "nav" });
  };

  return (
    <TabsPrimitive.Root
      value={tab}
      onValueChange={change}
      orientation={segmented ? "horizontal" : "vertical"}
      activationMode="automatic"
      className="mx-auto grid min-h-0 w-full max-w-[1280px] flex-1 grid-cols-[300px_minmax(0,1fr)] gap-10 px-8 pt-7 pb-5 narrow:grid-cols-[220px_minmax(0,1fr)] narrow:gap-6 vh700:px-8 vh700:pt-4 vh700:pb-3 tabbar:grid-cols-[minmax(0,1fr)] tabbar:grid-rows-[auto_minmax(0,1fr)] tabbar:gap-4 tabbar:px-4 tabbar:pt-5 tabbar:pb-3"
      data-testid="hwg-stage"
    >
      <div className="flex min-h-0 flex-col gap-4">
        {intro}
        <TabsPrimitive.List
          aria-label="Sections"
          className="flex flex-col gap-1 tabbar:flex-row tabbar:gap-0 tabbar:border tabbar:border-cb-border-strong tabbar:bg-cb-surface"
          data-testid="hwg-tabs"
        >
          {HWG_TABS.map((t) => (
            <TabsPrimitive.Trigger
              key={t}
              value={t}
              data-testid={`hwg-tab-${t}`}
              className={cn(
                "min-h-11 cursor-pointer border-0 border-l-2 border-transparent bg-transparent px-3.5 text-left text-body text-cb-text-soft transition-colors duration-150 [-webkit-tap-highlight-color:transparent] hover:text-cb-text focus-visible:-outline-offset-2",
                "data-[state=active]:border-l-cb-accent data-[state=active]:bg-cb-surface data-[state=active]:font-medium data-[state=active]:text-cb-text",
                "tabbar:min-h-11 tabbar:flex-1 tabbar:basis-0 tabbar:border-l-0 tabbar:border-r tabbar:border-cb-border-strong tabbar:text-center tabbar:text-ui tabbar:last:border-r-0 tabbar:data-[state=active]:bg-cb-accent tabbar:data-[state=active]:text-cb-accent-fg",
              )}
            >
              {TAB_LABEL[t]}
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>
        <div className="mt-auto border-t border-cb-border pt-3.5 vh700:hidden tabbar:hidden">{footnote}</div>
      </div>
      {HWG_TABS.map((t) => (
        <TabsPrimitive.Content
          key={t}
          value={t}
          className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cb-text"
          data-testid={`hwg-panel-${t}`}
          data-rc-scroll=""
        >
          {panels[t]}
          <div className="hidden border-t border-cb-border pt-3 tabbar:block">{footnote}</div>
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
