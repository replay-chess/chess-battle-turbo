// PreliminaryList (phase-06 plan §4.4, §8.10): "What we can see so far" — ≤ 3 cards (label, "Seen in 5 of 14 games",
// the warn Tag "Preliminary"), a `ul` of non-interactive items, then the chance note with the "How this is calculated"
// link. Under 5 analysed games: the card-size empty state ("Nothing Yet").
import Link from "next/link";
import type { WeaknessPreliminary } from "@repo/contracts/http/weakness";
import { EmptyState } from "@/components/ui/empty-state";
import { Tag } from "@/components/ui/tag";
import { copy } from "./copy";

export function PreliminaryList({ rows }: { rows: readonly WeaknessPreliminary[] }) {
  return (
    <section aria-labelledby="weakness-prelim-h" className="flex min-w-0 flex-col gap-2.5" data-testid="weakness-preliminary">
      <h3 id="weakness-prelim-h" className="m-0 text-overline">
        {copy.seeSoFar}
      </h3>
      {rows.length === 0 ? (
        <EmptyState size="card" title={copy.emptyTitle} body={copy.emptyBody} headingLevel={3} data-testid="weakness-preliminary-empty" />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {rows.map((r) => (
            <li key={r.pattern} className="flex min-h-16 items-center gap-3 border border-cb-border bg-cb-surface px-4 py-3" data-pattern={r.pattern}>
              <span className="flex min-w-0 flex-auto flex-col">
                <span className="font-medium [overflow-wrap:anywhere]">{r.label}</span>
                <span className="text-ui text-cb-text-soft">{copy.seenIn(r.seenIn, r.of)}</span>
              </span>
              <Tag tone="warn">{copy.preliminaryTag}</Tag>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 text-ui text-cb-text-soft">
        {copy.chanceNote}{" "}
        <Link href={copy.howHref} prefetch={false} className="inline-flex min-h-6 items-center text-cb-text underline underline-offset-3">
          {copy.howLink}
        </Link>
      </p>
    </section>
  );
}
