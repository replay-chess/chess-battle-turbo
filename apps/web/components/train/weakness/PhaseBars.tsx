// PhaseBars (phase-06 plan §4.6 "By phase"; board `isPhase`): the template sentence, then Opening / Middlegame /
// Endgame with "You 88 · band 84" and two 6 px bars (accuracy 0–100); a phase below the band is drawn in the
// `--cb-bad` tint (board `worse`). The legend names the band. The bars are decorative: the numbers are the text.
import type { WeaknessBreakdown } from "@repo/contracts/http/weakness";
import { cn } from "@/lib/utils";
import { copy } from "./copy";
import { phaseWorse } from "./model";

export function PhaseBars({ phase, bandLabel }: { phase: WeaknessBreakdown["phase"]; bandLabel: string | null }) {
  return (
    <div className="flex flex-col gap-3" data-testid="weakness-phase">
      <p className="m-0 text-sm text-cb-text-secondary">{phase.sentence}</p>
      {phase.rows.map((r) => {
        const band = bandLabel ? r.band : null;
        const worse = phaseWorse(r.you, band);
        return (
          <div key={r.phase} className="flex flex-col gap-1.5" data-phase={r.phase} data-worse={worse ? "" : undefined}>
            <span className="flex justify-between gap-3 text-sm">
              <span className="font-medium">{r.label}</span>
              <span className="font-mono text-xs tabular-nums">{copy.phaseRow(r.you, band)}</span>
            </span>
            <span aria-hidden="true" className="flex flex-col gap-[3px]">
              <span className={cn("block h-1.5", worse ? "bg-cb-bad" : "bg-cb-accent")} style={{ width: `${r.you ?? 0}%` }} />
              {band !== null ? <span className="block h-1.5 bg-cb-text/20" style={{ width: `${band}%` }} /> : null}
            </span>
          </div>
        );
      })}
      <span className="flex flex-wrap gap-3.5 text-xs text-cb-text-soft">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-1.5 w-3.5 bg-cb-accent" />
          {copy.legendYou}
        </span>
        {bandLabel ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-1.5 w-3.5 bg-cb-text/20" />
            {copy.legendBand(bandLabel)}
          </span>
        ) : null}
      </span>
    </div>
  );
}
