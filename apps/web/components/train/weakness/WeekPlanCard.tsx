// WeekPlanCard (phase-06 plan §4.6, §8.15; board `.tall` block): "This week's plan from your profile" with the drill
// row (top pattern), the puzzles row (first matchable pattern) and, from P8, a legend-lesson row. Shown on the desktop
// and iPad landscape, hidden at vh640 (the board's `.tall`) and in the tab-bar form. The drill row opens the drill
// config in place (the screen's onDrill), the others are links.
import Link from "next/link";
import { ArrowRight, BookOpen, Puzzle, Target } from "lucide-react";
import type { WeekPlanRow } from "@repo/contracts/http/weakness";
import { cn } from "@/lib/utils";
import { copy } from "./copy";

const ICON = { drill: Target, puzzles: Puzzle, lesson: BookOpen } as const;

export function WeekPlanCard({ rows, onFollow, className }: { rows: readonly WeekPlanRow[]; onFollow: (row: WeekPlanRow, e: React.MouseEvent) => void; className?: string }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="weakness-plan-h" className={cn("flex shrink-0 flex-col gap-0.5 border border-cb-border bg-cb-surface px-3.5 py-3 vh640:hidden tabbar:hidden", className)} data-testid="weakness-week-plan">
      <h2 id="weakness-plan-h" className="m-0 pb-1 text-overline">
        {copy.weekPlan}
      </h2>
      {rows.map((r) => {
        const Icon = ICON[r.kind];
        return (
          <Link
            key={r.kind}
            href={r.href}
            prefetch={false}
            scroll={false}
            onClick={(e) => onFollow(r, e)}
            className="flex min-h-[52px] items-center gap-3 border-b border-cb-border py-1.5 text-cb-text no-underline last:border-b-0 hover:bg-cb-fill"
            data-testid={`weakness-plan-${r.kind}`}
          >
            <Icon aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.75} />
            <span className="flex min-w-0 flex-auto flex-col">
              <span className="font-medium">{r.label}</span>
              <span className="text-ui text-cb-text-soft">{r.sub}</span>
            </span>
            <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
          </Link>
        );
      })}
    </section>
  );
}
