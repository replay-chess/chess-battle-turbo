"use client";

// Compare's error boundary (phase-03 plan §10.2 "an error boundary around CompareScreen"): reports to Sentry with the
// request id of an ApiError, then offers a retry and the way back to the review. A 404 on a client refetch renders
// the not-found answer.
import Link from "next/link";
import { useEffect } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { isApiError } from "@/lib/api/errors";
import { ReviewNotFound } from "@/features/review/components/ReviewNotFound";
import { captureBoundaryError } from "@/lib/sentry/review";

export default function CompareError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureBoundaryError(error, "compare");
  }, [error]);
  if (isApiError(error) && error.status === 404) return <ReviewNotFound />;
  return (
    <div style={{ minHeight: "60dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} data-testid="compare-error">
      <EmptyState
        title="This Comparison Didn’t Load"
        body="Something went wrong on our side. Your game and its review are safe."
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
          <Link href="/games" className="text-sm underline underline-offset-4">
            Back to My Games
          </Link>
        }
      />
    </div>
  );
}
