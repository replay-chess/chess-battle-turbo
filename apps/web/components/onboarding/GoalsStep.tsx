"use client";

// Goals `/onboarding/goals` (phase-04 plan §4.5, §8.3; V3OnbGoals, V3iPhoneOnbGoals, V3iPadOnbGoals).
// States: `default` (≥ 1 goal: the "Your day" preview) and `none_selected` (status "Pick at least one goal to
// continue.", Continue aria-disabled, the preview says "Choose a goal to see a sample day.").
// Five toggle chips (aria-pressed; Space/Enter toggle) and the daily time (5 / 10 / 20 min, a radio group: ←/→ move,
// Enter submits). Continue → advance("plan", {goals, dailyMinutes}); Skip → advance("plan", {goals:
// ["stop_blundering"], dailyMinutes: 10}) so Home has something to lead with.
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { toWire, type DailyMinutes, type OnboardingGoalDb } from "@repo/contracts/http/p04-plain";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { useOnboardingStep } from "@/lib/api/mutations/onboarding";
import { GOAL_COPY, GOAL_ORDER, SKIP_GOALS, SKIP_MINUTES, goalsState, orderedGoals, previewDay } from "@/lib/onboarding/day-preview";
import { stepPath } from "@/lib/onboarding/steps";
import { trackOnboarding } from "@/lib/onboarding/telemetry";
import { DayPreview } from "./DayPreview";
import { OnbFooter, OnbStage, StepHeading } from "./OnbStage";
import { submitOnEnter } from "./submit-on-enter";

export type GoalsStepProps = {
  /** The saved goals, else the board's default pair (initialGoalsState()). */
  initialGoals: OnboardingGoalDb[];
  initialMinutes: DailyMinutes;
  demo?: boolean;
};

const MINUTE_ITEMS = [5, 10, 20].map((m) => ({ value: String(m) as "5" | "10" | "20", label: `${m} min` }));

export function GoalsStep({ initialGoals, initialMinutes, demo = false }: GoalsStepProps) {
  const router = useRouter();
  const { advance, isSaving } = useOnboardingStep();
  const [goals, setGoals] = useState<OnboardingGoalDb[]>(() => orderedGoals(initialGoals));
  const [minutes, setMinutes] = useState<DailyMinutes>(initialMinutes);
  const statusId = useId();
  const asideHeading = useId();
  const inlineHeading = useId();
  const chips = useRef<HTMLDivElement>(null);
  const shownAt = useRef(0);

  useEffect(() => {
    shownAt.current = performance.now();
    if (demo) return;
    trackOnboarding("onb_step_viewed", { step: "goals" });
    router.prefetch(stepPath("plan"));
  }, [demo, router]);

  const state = goalsState(goals);
  const none = state === "none_selected";
  const preview = previewDay(goals, minutes);

  const toggle = (goal: OnboardingGoalDb) => {
    const next = goals.includes(goal) ? goals.filter((g) => g !== goal) : orderedGoals([...goals, goal]);
    setGoals(next);
    if (!demo) trackOnboarding("onb_goals_changed", { goals: next.map((g) => toWire(g)) });
  };

  const pickMinutes = (value: string) => {
    const m = Number(value) as DailyMinutes;
    setMinutes(m);
    if (!demo) trackOnboarding("onb_minutes_changed", { minutes: m });
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (demo || isSaving) return;
    if (none) {
      chips.current?.querySelector<HTMLButtonElement>("button")?.focus();
      return;
    }
    trackOnboarding("onb_step_completed", { step: "goals", ms_on_step: Math.round(performance.now() - shownAt.current) });
    void advance("plan", { goals: goals.map((g) => toWire(g)), dailyMinutes: minutes });
  };

  const skip = () => {
    if (demo || isSaving) return;
    trackOnboarding("onb_step_skipped", { step: "goals" });
    void advance("plan", { goals: SKIP_GOALS.map((g) => toWire(g)), dailyMinutes: SKIP_MINUTES });
  };

  return (
    <OnbStage
      label="Your goals"
      state={state}
      testId="onb-goals"
      onSubmit={onSubmit}
      aside={<DayPreview preview={preview} headingId={asideHeading} />}
      inline={{ kind: "card", node: <DayPreview preview={preview} headingId={inlineHeading} /> }}
      footer={
        <OnbFooter
          secondary={
            <Button type="button" variant="text" className="onb-skip" onClick={skip} data-testid="onb-skip">
              Skip
            </Button>
          }
          primary={
            <Button
              type="submit"
              size="lg"
              className="onb-primary"
              loading={isSaving}
              aria-disabled={none ? true : undefined}
              aria-describedby={none ? statusId : undefined}
              iconEnd={<ArrowRight aria-hidden="true" />}
              data-testid="onb-continue"
            >
              Continue
            </Button>
          }
        />
      }
    >
      <StepHeading>What do you want from it?</StepHeading>
      <p className="onb-p">Pick any. Your Home screen leads with these.</p>
      <fieldset className="onb-fieldset">
        <legend className="onb-lbl onb-legend">Goals</legend>
        <div className="onb-grow" ref={chips} data-testid="onb-goal-chips">
          {GOAL_ORDER.map((goal) => {
            const on = goals.includes(goal);
            return (
              <button
                key={goal}
                type="button"
                className="onb-chip"
                aria-pressed={on}
                onClick={() => toggle(goal)}
                data-goal={toWire(goal)}
              >
                {on ? <Check aria-hidden="true" className="onb-chip__check" /> : null}
                {GOAL_COPY[goal].label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="onb-fieldset">
        <legend className="onb-lbl onb-legend">Time a day</legend>
        <div onKeyDown={submitOnEnter} className="onb-seg-wrap">
          <Segmented
            aria-label="Daily time"
            value={String(minutes) as "5" | "10" | "20"}
            onValueChange={pickMinutes}
            items={MINUTE_ITEMS}
            className="onb-seg"
            data-testid="onb-minutes"
          />
        </div>
      </fieldset>
      <p id={statusId} role="status" className="onb-hint onb-live" data-testid="onb-goals-status">
        {none ? "Pick at least one goal to continue." : ""}
      </p>
    </OnbStage>
  );
}
