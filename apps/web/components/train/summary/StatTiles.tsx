// The summary's stat tiles (§4.7): "4 / 5 Solved · 3 First try · 1 With a hint" (perfect: "5 / 5 · 5 · 0 Hints"),
// "Skipped" only when something was skipped. Per distinct item: a re-queued pass-2 item is not counted twice.
import type { SessionSummary } from "@repo/contracts/http/train";
import { statTiles } from "./model";

export function StatTiles({ summary }: { summary: SessionSummary }) {
  return (
    <dl className="ts-stats" aria-label="Session results" data-testid="summary-stats">
      {statTiles(summary).map((t) => (
        <div className="ts-stat" key={t.id} data-testid={`summary-stat-${t.id}`}>
          <dt className="ts-lbl">{t.label}</dt>
          <dd className="ts-mono">{t.value}</dd>
        </div>
      ))}
    </dl>
  );
}
