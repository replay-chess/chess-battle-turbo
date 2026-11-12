"use client";

// The review's error boundary (plan §10.2): reports to Sentry with the request id of an ApiError, then offers a
// retry and the way back. A 404 on a client refetch (the game disappeared) renders the not-found answer.
import Link from "next/link";
import { useEffect } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { isApiError } from "@/lib/api/errors";
import { ReviewNotFound } from "@/features/review/components/ReviewNotFound";
import { captureBoundaryError } from "@/lib/sentry/review";

export default function ReviewError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureBoundaryError(error, "review");
  }, [error]);
  if (isApiError(error) && error.status === 404) return <ReviewNotFound />;
  return (
    <div style={{ minHeight: "60dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} data-testid="review-error">
      <EmptyState
        title="This Review Didn’t Load"
        body="Something went wrong on our side. Your moves and grades are safe."
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
