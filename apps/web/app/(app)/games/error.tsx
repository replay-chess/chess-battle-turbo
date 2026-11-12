"use client";

// The archive's error boundary (phase-03 plan §10.2 "an error boundary around GameList"): reports to Sentry with the
// request id of an ApiError, then offers a retry. Signed-out and paywall answers never reach it (the gate redirects).
import Link from "next/link";
import { useEffect } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { captureBoundaryError } from "@/lib/sentry/review";

export default function GamesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureBoundaryError(error, "games");
  }, [error]);
  return (
    <div style={{ minHeight: "60dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} data-testid="games-error">
      <EmptyState
        title="Your Games Didn’t Load"
        body="Something went wrong on our side. Your games and reviews are safe."
        primary={
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center justify-center bg-cb-accent px-4 text-sm font-medium text-cb-accent-fg hover:bg-cb-accent-hover"
          >
            Try Again
          </button>
        }
        secondary={
          <Link href="/play" className="text-sm underline underline-offset-4">
            Play a Game
          </Link>
        }
      />
    </div>
  );
}
