"use client";

// Level `/onboarding/level` (phase-04 plan §4.4, §8.2; V3OnbRating, V3iPhoneOnbRating, V3iPadOnbRating).
// States: `prefilled` (a linked account suggested a band: the banner "From Chess.com: Rapid 1184. …", the band
// checked) and `manual` (no suggestion: "No linked account, so pick …", Continue aria-disabled until a pick).
// Continue → advance("goals", {ratingBand, ratingBandSource, initialRating}) (the suggestion's source and rating when
// kept, `self` + the band midpoint otherwise); Skip → advance("goals") with nothing set. The aside shows a sample
// puzzle for the picked band (none for "New to chess").
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Link2 } from "lucide-react";
import { toWire, type RatingBandDb } from "@repo/contracts/http/p04-plain";
import { StaticBoard } from "@/components/board/StaticBoard";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { useOnboardingStep } from "@/lib/api/mutations/onboarding";
import { samplePuzzleFor } from "@/lib/onboarding/sample-puzzles";
import {
  BAND_MIDPOINT,
  levelChoice,
  providerLabel,
  puzzleStart,
  timeClassLabel,
  type BandSuggestion,
  type SuggestProvider,
} from "@/lib/onboarding/suggest-band";
import { stepPath } from "@/lib/onboarding/steps";
import { trackOnboarding } from "@/lib/onboarding/telemetry";
import { BandPicker } from "./BandPicker";
import { OnbBack } from "./OnbNav";
import { OnbFooter, OnbStage, StepHeading } from "./OnbStage";

export type LevelStepProps = {
  /** The linked account's suggestion (stored at link, or computed from its ratings), or null. */
  suggestion: (BandSuggestion & { provider: SuggestProvider }) | null;
  /** The band to show checked first: the stored band, else the suggestion's, else none. */
  initialBand: RatingBandDb | null;
  /** Back arrow / Alt+←: the linked account's confirm URL, else Link. */
  backHref: string;
  demo?: boolean;
};

export function bandNote(band: RatingBandDb | null, suggestion: BandSuggestion | null): string {
  if (!band) return "Pick one to continue.";
  const rating = suggestion && suggestion.band === band ? suggestion.initialRating : BAND_MIDPOINT[band];
  return `Puzzles start near ${puzzleStart(rating)}, and coach lines skip what you already know.`;
}

export function asideNote(band: RatingBandDb | null): string {
  return band === "NEW_TO_CHESS"
    ? "We’ll start with how the pieces work together, not ratings."
    : "Puzzles and coach lines are pitched at your band and move with you as you improve.";
}

export function LevelStep({ suggestion, initialBand, backHref, demo = false }: LevelStepProps) {
  const router = useRouter();
  const { advance, isSaving } = useOnboardingStep();
  const [band, setBand] = useState<RatingBandDb | null>(initialBand);
  const noteId = useId();
  const group = useRef<HTMLDivElement>(null);
  const shownAt = useRef(0);
  const [nudge, setNudge] = useState(0);

  useEffect(() => {
    shownAt.current = performance.now();
    if (demo) return;
    trackOnboarding("onb_step_viewed", { step: "level" });
    router.prefetch(stepPath("goals"));
  }, [demo, router]);

  const state = suggestion ? "prefilled" : "manual";
  const puzzle = samplePuzzleFor(band);
  const board = puzzle ? <StaticBoard fen={puzzle.fen} label={puzzle.label} data-testid="onb-level-puzzle" /> : null;

  const completed = () =>
    trackOnboarding("onb_step_completed", { step: "level", ms_on_step: Math.round(performance.now() - shownAt.current) });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (demo || isSaving) return;
    if (!band) {
      // aria-disabled Continue: focus the picker; the note (its description) says "Pick one to continue."
      group.current?.querySelector<HTMLButtonElement>('[role="radio"][tabindex="0"]')?.focus();
      setNudge((n) => n + 1);
      return;
    }
    const choice = levelChoice(band, suggestion);
    trackOnboarding("onb_level_selected", {
      band: toWire(band),
      source: !suggestion ? "manual" : suggestion.band === band ? "suggested" : "changed",
    });
    completed();
    void advance("goals", {
      ratingBand: toWire(choice.ratingBand),
      ratingBandSource: choice.ratingBandSource,
      initialRating: choice.initialRating,
    });
  };

  const skip = () => {
    if (demo || isSaving) return;
    trackOnboarding("onb_step_skipped", { step: "level" });
    void advance("goals");
  };

  return (
    <OnbStage
      label="Your level"
      state={state}
      testId="onb-level"
      onSubmit={onSubmit}
      aside={
        <>
          <span className="onb-lbl">A puzzle at your level</span>
          {board ? <div className="onb-ab">{board}</div> : null}
          <p className="onb-p">{asideNote(band)}</p>
        </>
      }
      inline={board ? { kind: "board", board, label: "A puzzle at your level", tabletWidth: 380 } : null}
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
              aria-disabled={band ? undefined : true}
              aria-describedby={band ? undefined : noteId}
              iconEnd={<ArrowRight aria-hidden="true" />}
              data-testid="onb-continue"
            >
              Continue
            </Button>
          }
        />
      }
    >
      <OnbBack href={backHref} />
      <StepHeading>Where are you now?</StepHeading>
      {suggestion ? (
        <Banner tone="info" icon={<Link2 aria-hidden="true" />} live="off" data-testid="onb-level-banner">
          From {providerLabel(suggestion.provider)}:{" "}
          <span className="onb-mono">
            {timeClassLabel(suggestion.timeClass)} {suggestion.displayRating}
          </span>
          . We picked the band for you; change it if it feels off.
        </Banner>
      ) : (
        <p className="onb-p">No linked account, so pick the band that fits. A rough guess is fine; the coach adjusts after a few games.</p>
      )}
      <fieldset className="onb-fieldset">
        <legend className="onb-lbl onb-legend">Your level</legend>
        <BandPicker value={band} onChange={setBand} describedBy={noteId} groupRef={group} />
      </fieldset>
      <p className="onb-hint" id={noteId} aria-live="polite" data-nudge={nudge || undefined} data-testid="onb-band-note">
        {bandNote(band, suggestion)}
      </p>
    </OnbStage>
  );
}
