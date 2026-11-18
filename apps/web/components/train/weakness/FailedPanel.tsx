// FailedPanel (phase-06 plan §4.8, not designed; the V3Error500 pattern, centred like P1's inline ErrorState):
// "We couldn't build your profile" / "Something went wrong while comparing your games. Your games and Mistake Bank are
// fine.", Retry (TR-12) with its spinner (`retrying`), the Event ID only when the failure came from a request, and
// after a second failure "If this keeps happening, contact hello@playchess.tech". A 429 shows the inline countdown.
// FIX-1: `paused` (the worker's kill switch skipped the build; failure.retryable false): "Profile updates are paused"
// and no Retry, since a Retry would only arm another skipped job.
import Link from "next/link";
import type { RetryCountdownState } from "@/components/system/useRetryCountdown";
import { Button } from "@/components/ui/button";
import { copy } from "./copy";
import { RateLimitedInline } from "./RateLimitedInline";

export function FailedPanel({
  onRetry,
  retrying,
  failedAgain,
  eventId,
  limit,
  paused = false,
}: {
  /** The failure is not retryable: updates are paused (FIX-1). */
  paused?: boolean;
  onRetry: () => void;
  retrying: boolean;
  failedAgain: boolean;
  /** 8 characters of the request id of a failed Retry; null when the failure is the worker's. */
  eventId: string | null;
  limit?: RetryCountdownState;
}) {
  return (
    <div
      className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-3 px-6 py-10 text-center"
      data-testid="weakness-failed"
      data-state={paused ? "paused" : retrying ? "retrying" : failedAgain ? "failed_again" : "default"}
    >
      <h2 className="m-0 font-serif text-2xl/[1.1] font-normal tracking-[-0.01em] text-balance">{paused ? copy.pausedTitle : copy.failedTitle}</h2>
      <p className="m-0 text-body text-cb-text-secondary">{paused ? copy.pausedBody : copy.failedBody}</p>
      {!paused && failedAgain ? <p className="m-0 text-sm text-cb-text-secondary">{copy.failedAgain}</p> : null}
      {eventId ? <p className="m-0 font-mono text-label text-cb-text-soft">{copy.eventId(eventId)}</p> : null}
      {paused ? null : <Button
        loading={retrying}
        onClick={() => {
          if (!limit?.limited) onRetry();
        }}
        data-testid="weakness-retry"
        {...(limit?.controlProps ?? {})}
      >
        {copy.retry}
      </Button>}
      {!paused && limit ? <RateLimitedInline countdown={limit} lead={copy.rebuildLimited} /> : null}
      <Link href={copy.howHref} prefetch={false} className="inline-flex min-h-11 items-center text-sm text-cb-text underline underline-offset-3">
        {copy.howLink}
      </Link>
    </div>
  );
}
