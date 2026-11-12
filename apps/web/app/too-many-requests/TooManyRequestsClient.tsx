"use client";

// /too-many-requests body (plan §4.8; V3RateLimited `page`). Reads `?retry=<sec>&from=<path>`, counts down from the
// received seconds (performance.now() deltas, countdown.ts), then "Try Again" goes to `from` when it is a safe
// app-relative path, else "/". A full navigation, because the document itself was what got limited.
//
// The query is read from window.location with useSyncExternalStore (server snapshot: no query, so the static HTML is
// the default 0:30 state), not with useSearchParams: on a static page useSearchParams needs a Suspense boundary,
// and React streams a boundary's content as a hidden segment that its inline script reveals on the next animation
// frame. Until then the document held two copies of the page (the 0:30 fallback, visible, and the hidden content),
// and with frames starved (CI run 43259407710, chromium data-layer.spec "counts down and returns to a safe from") the
// fallback stayed for 15 s with a second hidden "429 · Too many requests". Without the boundary the static HTML is
// the page itself, and hydration moves it to ?retry at once.
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trackSystem } from "@/lib/analytics/system-events";
import {
  COUNTDOWN_TICK_MS,
  DEFAULT_RETRY_AFTER_SEC,
  formatMmSs,
  normalizeRetryAfter,
  startCountdown,
} from "@/components/system/countdown";
import { safeReturnPath } from "@/components/system/session-guard";

export const TOO_MANY_REQUESTS_COPY = {
  overline: "429 · Too many requests",
  title: "Slow Down a Little",
  body: "We’ve had a lot of requests from this connection in a short time.",
  tryAgain: "Try Again",
  why: "Why This Happens",
} as const;

/** The parsed query: whole seconds (default 30) and a safe return target (default "/"). */
export function parseTooManyRequestsParams(params: { get(name: string): string | null } | null | undefined) {
  return {
    retrySec: normalizeRetryAfter(params?.get("retry") ?? undefined, DEFAULT_RETRY_AFTER_SEC),
    target: safeReturnPath(params?.get("from"), "/"),
  };
}

function subscribeToLocation(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

/** `location.search` on the client ("" on the server and during hydration, so the static HTML matches). */
function useLocationSearch(): string {
  return useSyncExternalStore(
    subscribeToLocation,
    () => window.location.search,
    () => "",
  );
}

export function TooManyRequestsClient() {
  const search = useLocationSearch();
  const { retrySec, target } = parseTooManyRequestsParams(new URLSearchParams(search));
  // Remount (fresh countdown) when the query changes.
  return <TooManyRequestsCountdown key={`${retrySec}:${target}`} retrySec={retrySec} target={target} />;
}

function TooManyRequestsCountdown({ retrySec, target }: { retrySec: number; target: string }) {
  const [left, setLeft] = useState(retrySec);

  useEffect(() => {
    trackSystem("rate_limited_shown", {
      route_id: "document",
      bucket: "document",
      retry_after_sec: retrySec,
      surface: "page",
    });
    const countdown = startCountdown(retrySec);
    const tick = () => {
      const remaining = countdown.remaining();
      setLeft(remaining);
      if (remaining <= 0) clearInterval(id);
    };
    const id = setInterval(tick, COUNTDOWN_TICK_MS);
    tick();
    return () => clearInterval(id);
  }, [retrySec]);

  return (
    <TooManyRequestsView
      left={left}
      onTryAgain={() => {
        window.location.assign(target);
      }}
    />
  );
}

/** The markup; with no query (the static HTML) it is the default 0:30, disabled state. */
export function TooManyRequestsView({ left, onTryAgain }: { left: number; onTryAgain?: () => void }) {
  const ready = left <= 0;
  const label = formatMmSs(left);
  return (
    <div className="flex w-full max-w-[560px] flex-col items-center gap-4 text-center" data-testid="too-many-requests">
      <span
        aria-hidden="true"
        className="inline-flex size-11 items-center justify-center rounded-full bg-cb-fill text-cb-text"
      >
        <Clock className="size-5" />
      </span>
      <p className="m-0 text-overline">{TOO_MANY_REQUESTS_COPY.overline}</p>
      <h1 className="m-0 font-serif text-title font-normal text-balance">{TOO_MANY_REQUESTS_COPY.title}</h1>
      <p
        id="too-many-requests-status"
        role="status"
        className="m-0 text-body text-cb-text-soft text-pretty"
        data-testid="too-many-requests-status"
      >
        {TOO_MANY_REQUESTS_COPY.body}{" "}
        {ready ? (
          "The page is ready again."
        ) : (
          <>
            The page will be ready again in{" "}
            <span role="timer" aria-live="off" className="font-mono tabular-nums">
              {label}
            </span>
            .
          </>
        )}
      </p>
      <div className="flex w-full flex-col items-stretch gap-2.5 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
        <Button
          size="lg"
          className="w-full sm:w-auto sm:min-h-11"
          aria-disabled={ready ? undefined : true}
          aria-describedby={ready ? undefined : "too-many-requests-status"}
          onClick={() => {
            if (ready) onTryAgain?.();
          }}
          data-testid="too-many-requests-retry"
        >
          {ready ? TOO_MANY_REQUESTS_COPY.tryAgain : `${TOO_MANY_REQUESTS_COPY.tryAgain} in ${label}`}
        </Button>
        <Button variant="text" size="lg" asChild className="self-center sm:min-h-11">
          <Link href="/help">{TOO_MANY_REQUESTS_COPY.why}</Link>
        </Button>
      </div>
    </div>
  );
}
