"use client";

// ComputingPanel (phase-06 plan §4.5; DR/V3WeaknessComputing `computing`): left, "Building your profile", "Analysing
// {N} games" (+ "Your profile appears after the first 20 …" when N > 20), an 8 px bar, "{pct}% · {real ETA}" and the
// leave note; right, the 4 steps. `stalled` stops the bar and says so. `ready_flash`: when this mount watched the build
// and the refetch came back ready, "Ready / Your profile is ready", the headline and "See your weakness profile",
// which swaps to the profile with no request (the data is in the cache).
//
// Announcements: one polite sr-only status that changes at 25, 50, 75 and 100 % only; the visible percentage line is
// aria-live off, so a screen reader hears four milestones, not every tick.
import type { WeaknessPayload, WeaknessProgress } from "@repo/contracts/http/weakness";
import { etaText } from "@repo/chess-training/weakness/progress";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { copy } from "./copy";
import { computingHeading, milestoneOf } from "./model";
import { ProfileProgress } from "./ProfileProgress";

export function ComputingPanel({ payload, progress }: { payload: WeaknessPayload; progress: WeaknessProgress }) {
  const { h2, sub } = computingHeading(progress, payload.games.inScope);
  const milestone = milestoneOf(progress.pct);
  return (
    <div className="grid grid-cols-2 items-center gap-10 rail:gap-6 tabbar:grid-cols-1 tabbar:items-start tabbar:gap-3.5" data-testid="weakness-computing" data-stalled={progress.stalled ? "" : undefined} data-orphaned={progress.orphaned ? "" : undefined}>
      <p role="status" aria-live="polite" className="sr-only" data-testid="weakness-milestone">
        {milestone > 0 ? copy.milestone(milestone) : ""}
      </p>
      <div className="flex min-w-0 flex-col gap-4 tabbar:gap-3">
        <span className="text-overline">{copy.building}</span>
        <h2 className="m-0 font-serif text-[clamp(2rem,4.4vh,2.75rem)]/[1.05] font-normal tracking-[-0.01em] tabbar:text-[1.625rem]/[1.15]">{h2}</h2>
        {sub ? <p className="m-0 text-sm text-cb-text-secondary">{sub}</p> : null}
        <span aria-hidden="true" className="relative block h-2 overflow-hidden bg-cb-border" data-testid="weakness-progress-bar">
          <span
            className={cn("absolute inset-y-0 left-0 bg-cb-accent", progress.stalled ? "transition-none" : "transition-[width] duration-200 ease-linear motion-reduce:transition-none")}
            style={{ width: `${progress.pct}%` }}
          />
        </span>
        <span aria-live="off" className="font-mono tabular-nums" data-testid="weakness-eta">
          {copy.pctLine(progress.pct, etaText(progress.etaSec))}
        </span>
        {progress.stalled ? (
          <p className="m-0 border border-cb-warn/30 bg-cb-warn-bg px-3.5 py-3 text-sm" data-testid="weakness-stalled">
            {copy.stalled}
          </p>
        ) : null}
        <p className="m-0 text-cb-text-secondary">{copy.leaveNote}</p>
      </div>
      <ProfileProgress steps={progress.steps} stalled={progress.stalled} />
    </div>
  );
}

/** The `ready_flash` panel (§4.5): shown once when a watched build turns ready. */
export function ReadyFlash({ headline, onSee }: { headline: string | null; onSee: () => void }) {
  return (
    <div className="flex max-w-[640px] flex-col gap-4" role="status" data-testid="weakness-ready-flash">
      <Tag tone="good" className="self-start">
        {copy.readyTag}
      </Tag>
      <h2 className="m-0 font-serif text-[clamp(2rem,4.4vh,2.75rem)]/[1.05] font-normal tracking-[-0.01em] tabbar:text-[1.625rem]/[1.15]">{copy.readyH2}</h2>
      {headline ? <p className="m-0 text-cb-text-secondary">{headline}</p> : null}
      <Button size="lg" className="self-start" onClick={onSee} data-testid="weakness-see-profile">
        {copy.seeProfile}
      </Button>
    </div>
  );
}
