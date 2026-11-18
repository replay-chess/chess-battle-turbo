// InsufficientPanel (phase-06 plan §4.4; DR/V3WeaknessInsufficient `insufficient`): Tag "Preliminary", the serif h2
// ("6 more games and we can tell you what keeps costing you points"), the meter, the primary CTA (Connected accounts;
// "Check for new games" when an account is linked and idle), "Or play 6 more games here" (hidden at ≤ 0), and on the
// right the preliminary list (or the empty state). Two columns on the desktop and iPad L (gap 40 / 24), one column in
// the tab-bar form.
import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import type { WeaknessPayload } from "@repo/contracts/http/weakness";
import { buttonVariants } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { copy } from "./copy";
import { InsufficientMeter } from "./InsufficientMeter";
import type { InsufficientModel } from "./model";
import { PreliminaryList } from "./PreliminaryList";

export function InsufficientPanel({
  payload,
  model,
  linked,
  onImport,
  onPlay,
}: {
  payload: WeaknessPayload;
  model: InsufficientModel;
  linked: boolean;
  onImport: () => void;
  onPlay: () => void;
}) {
  return (
    <div
      className="grid grid-cols-2 items-center gap-10 rail:gap-6 tabbar:grid-cols-1 tabbar:items-start tabbar:gap-3.5"
      data-testid="weakness-insufficient"
      data-sub={model.sub}
    >
      <div className="flex min-w-0 flex-col gap-4 tabbar:gap-3.5">
        <Tag tone="warn" className="self-start">
          {copy.preliminaryTag}
        </Tag>
        <h2 className="m-0 font-serif text-[clamp(2rem,4.4vh,2.75rem)]/[1.05] font-normal tracking-[-0.01em] text-balance tabbar:text-[1.625rem]/[1.15]">{model.h2}</h2>
        <InsufficientMeter label={model.meterLabel} caption={model.meterCaption} pct={model.meterPct} />
        <div className="flex max-w-[460px] flex-col tabbar:max-w-none">
          <Link href={copy.importHref} prefetch={false} onClick={onImport} className={cn(buttonVariants({ size: "lg" }))} data-testid="weakness-import-cta">
            {linked ? copy.checkNewCta : copy.importCta}
          </Link>
          {model.playMore ? (
            <Link
              href={copy.playHref}
              prefetch={false}
              onClick={onPlay}
              className="flex min-h-[52px] items-center gap-3 border-b border-cb-border px-3.5 py-1.5 text-cb-text no-underline hover:bg-cb-fill"
              data-testid="weakness-play-cta"
            >
              <Play aria-hidden="true" className="size-[18px] shrink-0" />
              <span className="flex-auto">{model.playMore}</span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
            </Link>
          ) : null}
        </div>
      </div>
      <PreliminaryList rows={payload.preliminary} />
    </div>
  );
}
