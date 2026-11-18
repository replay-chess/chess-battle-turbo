"use client";

// BreakdownCard (phase-06 plan §4.6 "Tabs content"; board `.tpanel`): underline tabs By phase | Clock | Openings, plus
// Strengths on phones, iPad portrait and iPad landscape (the desktop shows the strengths box instead). Every tab's
// data is in the one payload, so switching makes no request; the arrows switch (Radix automatic activation) and the
// screen writes `?tab=` with replaceState. No clock data → no Clock tab, and the footnote says why.
import type { WeaknessBreakdown } from "@repo/contracts/http/weakness";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { STR_TAB_QUERY, STR_TAB_SHOWN } from "./classes";
import { ClockHistogram } from "./ClockHistogram";
import { copy, type WeaknessTab } from "./copy";
import { OpeningsTable } from "./OpeningsTable";
import { PhaseBars } from "./PhaseBars";
import { StrengthsList } from "./StrengthsList";

/** The tab actually shown: a Clock tab without clock data, or Strengths where it is not a tab, falls back to By phase. */
export function effectiveTab(tab: WeaknessTab, hasClock: boolean, strTab: boolean): WeaknessTab {
  if (tab === "clock" && !hasClock) return "phase";
  if (tab === "str" && !strTab) return "phase";
  return tab;
}

export function BreakdownCard({
  breakdown,
  bandLabel,
  tab,
  onTab,
}: {
  breakdown: WeaknessBreakdown;
  bandLabel: string | null;
  tab: WeaknessTab;
  onTab: (t: WeaknessTab) => void;
}) {
  // The Strengths trigger is always in the markup (no layout shift on phones) but hidden by CSS on the desktop; there
  // it is also disabled, so the arrow keys never land on an invisible tab.
  const strTab = useMediaQuery(STR_TAB_QUERY);
  const hasClock = breakdown.clock !== null;
  const value = effectiveTab(tab, hasClock, strTab);
  return (
    <section aria-label={copy.breakdown} className="flex min-h-0 flex-none flex-col border border-cb-border bg-cb-surface" data-testid="weakness-breakdown">
      <Tabs variant="overline" value={value} onValueChange={(v) => onTab(v as WeaknessTab)} className="min-h-0">
        <TabsList aria-label={copy.breakdown}>
          <TabsTrigger value="phase" className="flex-1 basis-0" data-testid="weakness-tab-phase">
            {copy.tabs.phase}
          </TabsTrigger>
          {hasClock ? (
            <TabsTrigger value="clock" className="flex-1 basis-0" data-testid="weakness-tab-clock">
              {copy.tabs.clock}
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="open" className="flex-1 basis-0" data-testid="weakness-tab-open">
            {copy.tabs.open}
          </TabsTrigger>
          <TabsTrigger value="str" disabled={!strTab} className={`flex-1 basis-0 ${STR_TAB_SHOWN}`} data-testid="weakness-tab-str">
            {copy.tabs.str}
          </TabsTrigger>
        </TabsList>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4 tabbar:p-3.5">
          <TabsContent value="phase">
            <PhaseBars phase={breakdown.phase} bandLabel={bandLabel} />
          </TabsContent>
          {breakdown.clock ? (
            <TabsContent value="clock">
              <ClockHistogram clock={breakdown.clock} />
            </TabsContent>
          ) : null}
          <TabsContent value="open">
            <OpeningsTable openings={breakdown.openings} />
          </TabsContent>
          <TabsContent value="str">
            <StrengthsList strengths={breakdown.strengths} />
          </TabsContent>
          {hasClock ? null : (
            <p className="m-0 text-xs text-cb-text-soft" data-testid="weakness-no-clock">
              {copy.noClock}
            </p>
          )}
        </div>
      </Tabs>
    </section>
  );
}
