// InsufficientMeter (phase-06 plan §4.4): an 8 px bar with the mono caption "14 / 20 games analysed", one `role=img`
// named "14 of 20 games analysed" (the board's markup; the bar itself is decorative).
export function InsufficientMeter({ label, caption, pct }: { label: string; caption: string; pct: number }) {
  return (
    <div role="img" aria-label={label} className="flex flex-col gap-1.5" data-testid="weakness-meter">
      <span aria-hidden="true" className="relative block h-2 overflow-hidden bg-cb-border">
        <span className="absolute inset-y-0 left-0 bg-cb-accent" style={{ width: `${pct}%` }} />
      </span>
      <span aria-hidden="true" className="font-mono text-ui tabular-nums">
        {caption}
      </span>
    </div>
  );
}
