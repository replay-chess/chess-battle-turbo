// ClockHistogram (phase-06 plan §4.6 "Clock"; board `.cbars`): the template sentence ("Blunders per 100 moves, by time
// left on your clock. Below 2 minutes the rate triples."), then a 4-bar column chart (> 5 min, 2–5 min, 1–2 min,
// < 1 min) 160 px tall (110 at vh700, 120 on phones), one `role=img` whose label is the full sentence of every value
// (TE P6 a11y), built on the server.
import type { WeaknessBreakdown } from "@repo/contracts/http/weakness";
import { clockHeights, fmt1 } from "./model";

export function ClockHistogram({ clock }: { clock: NonNullable<WeaknessBreakdown["clock"]> }) {
  const heights = clockHeights(clock.buckets);
  return (
    <div className="flex flex-col gap-3" data-testid="weakness-clock">
      <p className="m-0 text-sm text-cb-text-secondary">{clock.sentence}</p>
      <div role="img" aria-label={clock.ariaLabel} className="grid h-40 grid-cols-4 items-end gap-3.5 pt-2 vh700:h-[110px] tabbar:h-[120px] tabbar:gap-2.5">
        {clock.buckets.map((b, i) => (
          <div key={b.key} aria-hidden="true" className="flex h-full min-h-0 flex-col items-center gap-1.5" data-bucket={b.key}>
            {/* FIX-2 (round-2 #21): the bar is a % of its own track (the column minus the bucket label), and the value
                rides above it inside the track's reserved top band, so heights stay proportional to the values. */}
            <div className="relative mt-5 w-full min-h-0 flex-1" data-testid="weakness-clock-track">
              <span
                className="absolute inset-x-0 text-center font-mono text-xs tabular-nums"
                style={{ bottom: `calc(${heights[i]}% + 0.375rem)` }}
              >
                {b.per100 === null ? "–" : fmt1(b.per100)}
              </span>
              <span className="absolute inset-x-0 bottom-0 block bg-cb-accent" data-testid="weakness-clock-bar" style={{ height: `${heights[i]}%` }} />
            </div>
            <span className="font-mono text-2xs font-medium tracking-label whitespace-nowrap text-cb-text-soft uppercase">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
