"use client";

// ErrorState (plan §5.7, CDL §8.1; V3Error500 default → retrying → failed_again, V3RateLimited inline → inline_ready):
// the inline replacement for a region whose query failed with no data to show.
//
// Variants (derived from the error unless `variant` is given):
// - inline: "Couldn’t load {object}", Event ID (8 chars of x-request-id) with Copy, "Try Again" → onRetry;
// - offline: "Needs a connection";
// - rate_limited: "Too many requests. Try again in m:ss" counted down from retryAfterSec with performance.now()
//   deltas; the retry control is aria-disabled until 0, then (with `autoRetry`) retries once by itself.
//   TODO(1B·F8): render F8's <RetryCountdown> here once components/system/RetryCountdown.tsx exists.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, shortEventId } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

export type ErrorStateVariant = "inline" | "offline" | "rate_limited";

export type ErrorStateProps = {
  error: unknown;
  /** Retry: usually `query.refetch`. Without it no retry control renders. */
  onRetry?: () => unknown;
  /** True while the retry is in flight (`query.isFetching`). */
  retrying?: boolean;
  /** What failed to load, lower case: "openings" → "Couldn’t load openings". */
  object?: string;
  variant?: ErrorStateVariant;
  /** rate_limited: retry once by itself when the countdown reaches 0 (queries; never mutations). */
  autoRetry?: boolean;
  className?: string;
  "data-testid"?: string;
};

export function errorVariantOf(error: unknown): ErrorStateVariant {
  if (error instanceof ApiError) {
    if (error.code === "rate_limited") return "rate_limited";
    if (error.code === "offline") return "offline";
  }
  return "inline";
}

/** `m:ss` from whole seconds (65 → "1:05"). */
export function formatMmSs(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const FRAME = "flex w-full flex-col items-center gap-3 px-6 py-10 text-center";
const TITLE = "font-serif text-2xl/[1.1] font-normal tracking-[-0.01em] text-balance text-cb-text";
const BODY = "max-w-md text-sm text-cb-text-soft text-pretty";

export function ErrorState({
  error,
  onRetry,
  retrying = false,
  object = "this",
  variant,
  autoRetry = false,
  className,
  "data-testid": testId = "error-state",
}: ErrorStateProps) {
  const kind = variant ?? errorVariantOf(error);
  if (kind === "rate_limited") {
    const retryAfterSec = error instanceof ApiError ? (error.retryAfterSec ?? 30) : 30;
    return (
      <RateLimited
        key={`${retryAfterSec}:${error instanceof ApiError ? (error.requestId ?? "") : ""}`}
        retryAfterSec={retryAfterSec}
        onRetry={onRetry}
        retrying={retrying}
        autoRetry={autoRetry}
        className={className}
        testId={testId}
      />
    );
  }
  return (
    <Failed
      kind={kind}
      error={error}
      onRetry={onRetry}
      retrying={retrying}
      object={object}
      className={className}
      testId={testId}
    />
  );
}

function Failed({
  kind,
  error,
  onRetry,
  retrying,
  object,
  className,
  testId,
}: {
  kind: "inline" | "offline";
  error: unknown;
  onRetry?: () => unknown;
  retrying: boolean;
  object: string;
  className?: string;
  testId: string;
}) {
  const [tried, setTried] = useState(false);
  const [copied, setCopied] = useState(false);
  const apiError = error instanceof ApiError ? error : undefined;
  const event = shortEventId(apiError?.requestId);
  const serverSide = apiError ? apiError.status >= 500 : false;
  const state = kind === "offline" ? "offline" : retrying ? "retrying" : tried ? "failed_again" : "default";

  const title = kind === "offline" ? "Needs a connection" : `Couldn’t load ${object}`;
  const body =
    kind === "offline"
      ? "This loads when you’re back online."
      : state === "failed_again"
        ? serverSide
          ? "Still not working. We’ve been notified and are looking at it."
          : "Still not working. Check your connection and try again."
        : "Trying again usually fixes it.";

  const copy = async () => {
    if (!apiError?.requestId) return;
    try {
      await navigator.clipboard.writeText(apiError.requestId);
      setCopied(true);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions); the id stays visible to read out.
    }
  };

  return (
    <div role="alert" data-testid={testId} data-state={state} className={cn(FRAME, className)}>
      <h3 className={TITLE}>{title}</h3>
      <p className={BODY}>{body}</p>
      {event && kind === "inline" ? (
        <p className="flex items-center gap-2 font-mono text-xs text-cb-text-soft" data-testid={`${testId}-event`}>
          <span>Event {event}</span>
          <Button variant="text" size="sm" onClick={copy} aria-label={`Copy event ID ${event}`}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </p>
      ) : null}
      {onRetry ? (
        <Button
          variant="secondary"
          loading={retrying}
          loadingLabel="Retrying…"
          onClick={() => {
            setTried(true);
            void onRetry();
          }}
          data-testid={`${testId}-retry`}
        >
          Try Again
        </Button>
      ) : null}
    </div>
  );
}

function RateLimited({
  retryAfterSec,
  onRetry,
  retrying,
  autoRetry,
  className,
  testId,
}: {
  retryAfterSec: number;
  onRetry?: () => unknown;
  retrying: boolean;
  autoRetry: boolean;
  className?: string;
  testId: string;
}) {
  const [left, setLeft] = useState(retryAfterSec);
  const startedAt = useRef<number | null>(null);
  const autoRetried = useRef(false);

  useEffect(() => {
    // Count down from the received seconds with performance.now() deltas, never from absolute times (clock skew).
    startedAt.current ??= performance.now();
    const tick = () => {
      const elapsed = (performance.now() - (startedAt.current ?? performance.now())) / 1000;
      const remaining = Math.max(0, retryAfterSec - elapsed);
      setLeft(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        if (autoRetry && onRetry && !autoRetried.current) {
          autoRetried.current = true;
          void onRetry();
        }
      }
    };
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [retryAfterSec, autoRetry, onRetry]);

  const ready = left <= 0;
  const rowId = `${testId}-countdown`;
  return (
    <div data-testid={testId} data-state={ready ? "inline_ready" : "rate_limited"} className={cn(FRAME, className)}>
      {ready ? null : (
        <p id={rowId} role="status" className={BODY}>
          Too many requests. Try again in <span role="timer">{formatMmSs(left)}</span>
        </p>
      )}
      {onRetry ? (
        <Button
          variant="secondary"
          loading={retrying}
          loadingLabel="Retrying…"
          aria-disabled={ready ? undefined : true}
          aria-describedby={ready ? undefined : rowId}
          onClick={() => {
            if (ready) void onRetry();
          }}
          data-testid={`${testId}-retry`}
        >
          {ready ? "Try Again" : `Try Again in ${formatMmSs(left)}`}
        </Button>
      ) : null}
    </div>
  );
}
