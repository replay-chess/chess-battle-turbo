"use client";

// Welcome `/onboarding/welcome` (phase-04 plan §4.1; V3OnbWelcome, V3iPhoneOnbWelcome, V3iPadOnbWelcome).
// States: default; trial used (row 04 "Start your membership", no "7 DAYS FREE"); already linked (Get Started goes
// to Level with the band prefilled). Get Started = advance(link | level) with the browser's zone on the tab's first
// PATCH. Enter submits (the panel is a form).
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOnboardingStep } from "@/lib/api/mutations/onboarding";
import { stepPath } from "@/lib/onboarding/steps";
import { trackOnboarding } from "@/lib/onboarding/telemetry";
import { OnbFooter, OnbStage, StepHeading } from "./OnbStage";

export type WelcomeState = "default" | "trial_used" | "already_linked";

export type WelcomeStepProps = {
  name: string;
  trialEligible: boolean;
  /** An ACTIVE link exists: Get Started skips Link (the resolver never shows it). */
  linked: boolean;
  /** The legend board (StaticBoard, rendered on the server). */
  board: React.ReactNode;
  /** Demo routes: no navigation, no PATCH. */
  demo?: boolean;
};

const ROWS = [
  { no: "01", text: "Link Chess.com or Lichess", time: "30 S" },
  { no: "02", text: "Tell us your level", time: "10 S" },
  { no: "03", text: "Pick your goals", time: "10 S" },
] as const;

export function welcomeState(p: Pick<WelcomeStepProps, "trialEligible" | "linked">): WelcomeState {
  if (p.linked) return "already_linked";
  return p.trialEligible ? "default" : "trial_used";
}

export function WelcomeStep({ name, trialEligible, linked, board, demo = false }: WelcomeStepProps) {
  const router = useRouter();
  const { advance, isSaving } = useOnboardingStep();
  const target = linked ? "level" : "link";
  const shownAt = useRef(0);

  useEffect(() => {
    shownAt.current = performance.now();
    if (demo) return;
    trackOnboarding("onb_step_viewed", { step: "welcome" });
    // Link is one step ahead of Welcome, so the guard serves it; Level (an existing link) is not until Get Started
    // has saved the step, and a cached redirect would be replayed (regression: confirm-level-prefetch family).
    if (target === "link") router.prefetch(stepPath(target));
  }, [demo, router, target]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (demo || isSaving) return;
    trackOnboarding("onb_get_started_clicked", {});
    trackOnboarding("onb_step_completed", { step: "welcome", ms_on_step: Math.round(performance.now() - shownAt.current) });
    void advance(target);
  };

  return (
    <OnbStage
      label="Welcome"
      state={welcomeState({ trialEligible, linked })}
      testId="onb-welcome"
      onSubmit={onSubmit}
      aside={
        <>
          <span className="onb-lbl">Your first legend position</span>
          <div className="onb-ab">{board}</div>
          <p className="onb-p onb-tall">Kasparov vs Topalov, 1999. White to move. It&apos;s waiting for you at the end of setup.</p>
        </>
      }
      inline={{ kind: "board", board, label: "Your first legend position", tabletWidth: 440 }}
      footer={
        <OnbFooter
          primary={
            <Button type="submit" size="lg" className="onb-primary" loading={isSaving} iconEnd={<ArrowRight aria-hidden="true" />} data-testid="onb-get-started">
              Get Started
            </Button>
          }
        />
      }
    >
      <span className="onb-lbl">Welcome</span>
      <StepHeading>Welcome, {name}.</StepHeading>
      <p className="onb-lead">
        ReplayChess is your chess coach. It analyses your Chess.com games, finds the mistakes you keep making, and turns them
        into a short daily plan of reviews and puzzles.
      </p>
      <ol className="onb-steps" aria-label="What setup covers">
        {ROWS.map((r) => (
          <li key={r.no}>
            <span className="no" aria-hidden="true">
              {r.no}
            </span>
            <span>{r.text}</span>
            <span className="t onb-tall">{r.time}</span>
          </li>
        ))}
        <li data-testid="onb-welcome-trial-row">
          <span className="no" aria-hidden="true">
            04
          </span>
          <span>{trialEligible ? "Start your free trial" : "Start your membership"}</span>
          {trialEligible ? <span className="t">7 DAYS FREE</span> : <span />}
        </li>
      </ol>
      <p className="onb-hint">About a minute. You can change all of it later in Settings.</p>
    </OnbStage>
  );
}
