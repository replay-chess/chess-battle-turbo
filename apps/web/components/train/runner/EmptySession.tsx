"use client";

// A session the server built with no items (`SessionPayload.empty`, 201 instead of an error, §7.3 W2): everything is
// reviewed for now, today's cap is used, or the bank filter matched nothing. One centred card with the way on.
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import type { SessionPayload } from "@repo/contracts/http/train";

const COPY: Record<NonNullable<SessionPayload["empty"]>, { title: string; body: string }> = {
  caughtup: { title: "All Caught Up", body: "Nothing is due right now. Your next positions come back on their schedule." },
  cap_reached: { title: "Today's Reviews Are Done", body: "You reviewed today's positions. The rest come back tomorrow, so FSRS keeps each day short." },
  nothing_matches: { title: "Nothing Matches These Filters", body: "No position in your bank matches this filter. Clear a filter to see positions again." },
};

export function EmptySession({ reason, mode, demo }: { reason: NonNullable<SessionPayload["empty"]>; mode: "bank" | "puzzles"; demo: boolean }) {
  const c = COPY[reason];
  const base = demo ? "/dev/ui/train" : "/train";
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6" data-testid="trainer-empty" data-reason={reason}>
      <EmptyState
        title={c.title}
        body={c.body}
        ghostRows={0}
        size="card"
        headingLevel={2}
        primary={
          <Link className={buttonVariants({ variant: "primary", size: "lg" })} href={demo ? `${base}/hub` : base} prefetch={false}>
            Back to Train
          </Link>
        }
        secondary={
          mode === "bank" ? (
            <Link className={buttonVariants({ variant: "text" })} href={`${base}/bank`} prefetch={false}>
              Open Mistake Bank
            </Link>
          ) : undefined
        }
      />
    </div>
  );
}
