"use client";

// The resolver's claim self-heal (phase-04 plan D4-16). A member the database calls onboarded, whose session token
// still says `onboarded: false` (claims written before the JWT refreshed, a legacy completion that never synced
// them), would bounce between the destination and /onboarding: middleware sends them here, the resolver sends them
// on. This sends `{complete: true}` once: the handler re-syncs the Clerk claims and sets the 120 s `rc_onb` cookie
// middleware honours, the session token is reloaded, then the member continues to `next`.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { useCompleteOnboarding } from "@/lib/api/mutations/onboarding";

export function ClaimRefresh({ next }: { next: string }) {
  const router = useRouter();
  const complete = useCompleteOnboarding();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    complete.mutate(
      {},
      {
        onSuccess: () => router.replace(next),
      },
    );
  }, [complete, next, router]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-cb-bg px-6 text-center" data-testid="onb-claim-refresh">
      {complete.isError ? (
        <>
          <p className="m-0 text-body text-cb-text">We couldn&apos;t finish signing you in.</p>
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center bg-cb-accent px-4 text-sm font-medium text-cb-accent-fg hover:bg-cb-accent-hover"
            onClick={() => complete.mutate({}, { onSuccess: () => router.replace(next) })}
          >
            Try Again
          </button>
        </>
      ) : (
        <p role="status" className="m-0 flex items-center gap-2 text-body text-cb-text-soft">
          <Spinner />
          Finishing setup…
        </p>
      )}
    </div>
  );
}
