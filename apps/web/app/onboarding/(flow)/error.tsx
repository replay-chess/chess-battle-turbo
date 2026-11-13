"use client";

// A step that failed to render (phase-04 plan §4.0 "Shared states"): the V3Error500 card inside the onboarding frame
// (the (flow) layout keeps the header). Try Again = reset() + router.refresh(). Progress is safe: the step is stored
// monotonically, so a retry resumes where the member was.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/errors";
import { withSentry } from "@/lib/sentry/lazy";

export default function OnboardingStepError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const ref = error instanceof ApiError ? (error.requestId ?? null) : (error.digest ?? null);

  useEffect(() => {
    withSentry((Sentry) => Sentry.captureException(error, { tags: { screen: "onboarding" } }));
  }, [error]);

  const retry = () => {
    setRetrying(true);
    reset();
    router.refresh();
  };

  return (
    <div className="onb-stage" data-aside="none" data-testid="onb-error">
      <section className="onb-panel" aria-labelledby="onb-error-h">
        <div className="onb-form">
          <div className="onb-body">
            <span className="onb-lbl">Error on our side</span>
            <h1 id="onb-error-h" className="onb-h1" tabIndex={-1} data-onb-h1="">
              Something Went Wrong
            </h1>
            <p className="onb-p">This step hit an error. Your answers so far are saved. Trying again usually fixes it.</p>
            {ref ? (
              <p className="onb-hint">
                Reference <span className="onb-mono">{ref}</span>
              </p>
            ) : null}
          </div>
          <div className="onb-foot">
            <span className="onb-foot__spacer" />
            <Button type="button" size="lg" className="onb-primary" onClick={retry} loading={retrying} loadingLabel="Trying again…">
              Try Again
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
