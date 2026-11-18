// UpdatingChip (phase-06 plan §4.6 `updating`): "Updating with 4 new games…" while a recompute is queued or running on
// top of a ready profile. A polite status; the data refreshes on `weakness:ready`.
import { Spinner } from "@/components/ui/spinner";
import { copy } from "./copy";

export function UpdatingChip({ newGames }: { newGames: number }) {
  return (
    <span role="status" className="inline-flex min-h-7 items-center gap-1.5 border border-cb-border bg-cb-surface px-2 font-mono text-2xs tracking-label text-cb-text-soft uppercase" data-testid="weakness-updating">
      <Spinner size="sm" />
      {copy.updating(newGames)}
    </span>
  );
}
