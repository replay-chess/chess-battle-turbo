"use client";

// RetryCountdown (plan §4.8, §5.6; V3RateLimited `inline`): the field-level row under a host control that got a
// `429 rate_limited`: "Too many requests. Try again in 0:30".
//
// Two ways to use it:
// - with `useRetryCountdown` (the host also needs `controlProps` for its button):
//     const rl = useRetryCountdown(mutation, { routeId });
//     <Button {...rl.controlProps} …/> <RetryCountdown countdown={rl} />
// - standalone, from an error (QueryState / ErrorState regions):
//     <RetryCountdown error={query.error} onReady={() => query.refetch()} />
//
// The row is `role="status"` (polite); the m:ss itself is `role="timer"` with aria-live off, so screen readers
// announce the row once instead of every second. It renders nothing when no wait is running (`inline_ready`).
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRetryCountdown, type RetryCountdownState, type UseRetryCountdownOptions } from "./useRetryCountdown";

type Common = { className?: string; "data-testid"?: string };

export type RetryCountdownProps =
  | (Common & { countdown: RetryCountdownState })
  | (Common & { error: unknown; onReady?: () => unknown; routeId?: string; surface?: UseRetryCountdownOptions["surface"] });

export function RetryCountdown(props: RetryCountdownProps) {
  if ("countdown" in props) return <CountdownRow state={props.countdown} {...pickCommon(props)} />;
  return <StandaloneCountdown {...props} />;
}

function pickCommon(p: Common): Common {
  return { className: p.className, "data-testid": p["data-testid"] };
}

function StandaloneCountdown({
  error,
  onReady,
  routeId,
  surface,
  ...common
}: Common & { error: unknown; onReady?: () => unknown; routeId?: string; surface?: UseRetryCountdownOptions["surface"] }) {
  const state = useRetryCountdown({ error, status: "error" }, { onReady, routeId, surface });
  return <CountdownRow state={state} {...common} />;
}

function CountdownRow({
  state,
  className,
  "data-testid": testId = "retry-countdown",
}: Common & { state: RetryCountdownState }) {
  if (!state.limited) return null;
  return (
    <p
      id={state.rowId}
      role="status"
      data-testid={testId}
      data-state="inline"
      className={cn("m-0 flex items-start gap-1.5 text-ui leading-[1.4] text-cb-bad", className)}
    >
      <Clock aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>
        Too many requests. Try again in{" "}
        <span role="timer" aria-live="off" className="font-mono tabular-nums" data-testid={`${testId}-timer`}>
          {state.label}
        </span>
      </span>
    </p>
  );
}
