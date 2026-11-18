// MoreRow (phase-06 plan §4.6; board's last `.wrow`): "2 more patterns found. All 5 have drills." with "See all" /
// "Show fewer", which toggles rows 4–5 in place. The board's lock icon is a list icon (copy note C7: nothing is locked).
import { List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copy } from "./copy";

export function MoreRow({ more, total, showAll, onToggle, controls }: { more: number; total: number; showAll: boolean; onToggle: () => void; controls: string }) {
  if (more <= 0) return null;
  return (
    <div className="flex min-h-14 items-center gap-3 border border-cb-border bg-cb-surface px-3.5 py-3" data-testid="weakness-more">
      <List aria-hidden="true" className="size-4 shrink-0" />
      <span className="flex-auto text-sm">{copy.morePatterns(more, total)}</span>
      <Button variant="text" onClick={onToggle} aria-expanded={showAll} aria-controls={controls} data-testid="weakness-see-all">
        {showAll ? copy.showFewer : copy.seeAll}
      </Button>
    </div>
  );
}
