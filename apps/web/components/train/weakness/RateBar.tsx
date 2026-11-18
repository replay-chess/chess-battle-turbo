// RateBar (phase-06 plan §4.6; board `.whead` third column): the member's rate next to the rating band's, two 5 px
// bars on one scale (`rateScaleMax` over every row) with mono values. One `role=img` with the full sentence, so a
// screen reader hears "You 3.1 per 100 moves, rating band 1.6"; the drawn parts are hidden. Without a band (own_only,
// most_frequent) it is a single bar and the label drops the band. The time-pressure row's rate is per 100 moves made
// with under a minute (plan §4.6 "You 4.0 under 1 min · band 2.2"): its unit is written under the bars (FIX-1), so
// "25.1 / 6.7" is never read on the "per 100 moves" scale of the other rows.
import type { WeaknessRow } from "@repo/contracts/http/weakness";
import { cn } from "@/lib/utils";
import { copy } from "./copy";
import { barPct, fmt1, rateAria } from "./model";

export function RateBar({ row, scaleMax, withBand, className }: { row: Pick<WeaknessRow, "you" | "band" | "unit">; scaleMax: number; withBand: boolean; className?: string }) {
  const band = withBand && row.band !== null ? row.band : null;
  return (
    <span role="img" aria-label={rateAria(row, withBand)} className={cn("flex min-w-0 flex-col gap-1", className)} data-testid="weakness-rate">
      <span aria-hidden="true" className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1">
          <span className="block h-[5px] bg-cb-accent" style={{ width: `${barPct(row.you, scaleMax)}%` }} />
        </span>
        <span className="w-7 shrink-0 font-mono text-label tabular-nums text-cb-text">{fmt1(row.you)}</span>
      </span>
      {band !== null ? (
        <span aria-hidden="true" className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1">
            <span className="block h-[5px] bg-cb-text/25" style={{ width: `${barPct(band, scaleMax)}%` }} />
          </span>
          <span className="w-7 shrink-0 font-mono text-label tabular-nums text-cb-text-soft">{fmt1(band)}</span>
        </span>
      ) : null}
      {row.unit === "per100_under1min" ? (
        <span aria-hidden="true" className="self-end font-mono text-label text-cb-text-soft" data-testid="weakness-rate-unit">
          {copy.rateUnderMinute}
        </span>
      ) : null}
    </span>
  );
}
