// RateLimitedInline (phase-06 plan §4.7 `rateLimited`, §4.8 429): the inline countdown under a control that got
// `429 rate_limited` — "Too many sessions. Try again in 9:52". The state is useRetryCountdown's (it counts down from
// `retryAfterSec` and wires `aria-describedby` on the control); only the lead sentence differs from the shared
// RetryCountdown row. The row is polite; the m:ss itself is `role=timer` with aria-live off (announced once).
import { Clock } from "lucide-react";
import type { RetryCountdownState } from "@/components/system/useRetryCountdown";
import { cn } from "@/lib/utils";

export function RateLimitedInline({ countdown, lead, className, testId = "weakness-rate-limited" }: { countdown: RetryCountdownState; lead: string; className?: string; testId?: string }) {
  if (!countdown.limited) return null;
  return (
    <p id={countdown.rowId} role="status" data-testid={testId} className={cn("m-0 flex items-start gap-1.5 text-ui leading-[1.4] text-cb-bad", className)}>
      <Clock aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>
        {lead}{" "}
        <span role="timer" aria-live="off" className="font-mono tabular-nums" data-testid={`${testId}-timer`}>
          {countdown.label}
        </span>
      </span>
    </p>
  );
}
