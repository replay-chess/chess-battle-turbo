"use client";

// Link `/onboarding/link` (phase-04 plan §4.2; V3OnbLink, V3iPhoneOnbLink, V3iPadOnbLink).
//
// Chess.com card: the username field and "Look Up Profile"; the result line under it is a polite live region tied to
// the input (aria-describedby). States: default, validating, found (incl. no rated games), not_found,
// private_profile, rate_limited (countdown from `retryAfterSec`, the button aria-disabled until 0:00, never
// auto-retried), and the undrawn linked_elsewhere / upstream rows. Lichess card: "Connect Lichess ↗" is a full
// navigation to OAU-1 (`returnTo=/onboarding/link`); `?lichess=denied|error&reason=` come back here.
//
// Enter: Look Up while not found; once found (or private), Continue. Typing after a result returns to default.
// No debounce, no auto-lookup (Chess.com limits). Continue is aria-disabled until found: activating it focuses the
// input and announces "Look up your profile first." Skip for now → advance("level").
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, Check, Clock, Lock, TriangleAlert, X } from "lucide-react";
import type { LookupData } from "@repo/contracts/http/accounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useRetryCountdown } from "@/components/system/useRetryCountdown";
import { useChessComLookup } from "@/lib/api/mutations/accounts";
import { useOnboardingStep } from "@/lib/api/mutations/onboarding";
import {
  continueTarget,
  foundDetail,
  lichessErrorCopy,
  lookupResultProp,
  normaliseTyped,
  stateFromLookup,
  usernameProblem,
  type ChessComCardState,
  type LichessCardState,
} from "@/lib/onboarding/link-state";
import { lichessReasonProp, trackOnboarding } from "@/lib/onboarding/telemetry";
import { OnbFooter, OnbStage, StepHeading } from "./OnbStage";

export const LICHESS_START_HREF = "/api/accounts/lichess/start?returnTo=%2Fonboarding%2Flink";

export type LinkStepProps = {
  /** The typed value to start with (an existing link's handle, or `?u=` from a Confirm return). */
  initialUsername: string;
  /** The first card state (found for an existing link; not_found / linked_elsewhere from a Confirm return). */
  initialState: ChessComCardState;
  lichess: LichessCardState;
  /** Demo routes: the card state is fixed and nothing is sent. */
  demo?: boolean;
  /** Demo: the rate-limit countdown label ("0:30"). */
  demoCountdown?: string;
  /** Focus the username field on arrival (Confirm's "Not Me" → `?retry=1`). */
  focusInput?: boolean;
};

/** `is_cache_hit` from the lookup's Server-Timing entry (`cache;desc=hit`), when the response carried one. */
function lookupCacheHit(): boolean {
  try {
    const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!;
      if (!e.name.includes("/api/accounts/chesscom/lookup")) continue;
      return (e.serverTiming ?? []).some((t) => (t.name === "cache" && t.description === "hit") || t.name === "cache_hit");
    }
  } catch {
    // no Resource Timing (old engines): unknown reads as a miss
  }
  return false;
}

function Msg({ tone, icon, children, testId }: { tone?: "warn"; icon: React.ReactNode; children: React.ReactNode; testId: string }) {
  return (
    <p className="onb-msg" data-tone={tone} data-testid={testId}>
      {icon}
      <span>{children}</span>
    </p>
  );
}

export function LinkStep({ initialUsername, initialState, lichess: initialLichess, demo = false, demoCountdown, focusInput = false }: LinkStepProps) {
  const router = useRouter();
  const { advance, isSaving } = useOnboardingStep();
  const lookup = useChessComLookup();
  const limit = useRetryCountdown(lookup, { routeId: "accounts.chesscom.lookup" });
  const [typed, setTyped] = useState(initialUsername);
  const [card, setCard] = useState<ChessComCardState>(initialState);
  const [lichess, setLichess] = useState<LichessCardState>(initialLichess);
  const [hint, setHint] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const msgId = useId();
  const shownAt = useRef(0);
  const lookupStarted = useRef(0);

  useEffect(() => {
    shownAt.current = performance.now();
    if (demo) return;
    trackOnboarding("onb_step_viewed", { step: "link" });
    if (initialLichess.kind !== "idle") {
      trackOnboarding("onb_link_lichess_result", {
        result: initialLichess.kind === "denied" ? "denied" : "error",
        reason: initialLichess.kind === "error" ? lichessReasonProp(initialLichess.reason) : "access_denied",
      });
    }
  }, [demo, initialLichess]);

  useEffect(() => {
    if (focusInput) input.current?.focus();
  }, [focusInput]);

  // A rate-limited card returns to default once the wait is over (the control is usable again).
  const limited = demo ? card.kind === "rate_limited" : card.kind === "rate_limited" && limit.limited;
  const shown: ChessComCardState = card.kind === "rate_limited" && !limited ? { kind: "default" } : card;
  const busy = shown.kind === "validating";
  const target = continueTarget(shown);

  const runLookup = (raw: string) => {
    const value = normaliseTyped(raw);
    if (!value) {
      input.current?.focus();
      return;
    }
    const problem = usernameProblem(value);
    if (problem) {
      setCard({ kind: "invalid", typed: value });
      return;
    }
    setHint(null);
    setCard({ kind: "validating" });
    trackOnboarding("onb_link_lookup_submitted", { provider: "chesscom" });
    lookupStarted.current = performance.now();
    lookup.mutate(value, {
      onSettled: (data: LookupData | undefined, error: unknown) => {
        if (error && (error as { code?: string }).code === "aborted") return;
        const next = stateFromLookup({ data, error: data ? undefined : error }, value);
        setCard(next);
        trackOnboarding("onb_link_lookup_result", {
          result: lookupResultProp(next),
          ms: Math.round(performance.now() - lookupStarted.current),
          is_cache_hit: data ? lookupCacheHit() : false,
        });
        const to = continueTarget(next);
        if (to?.kind === "confirm") router.prefetch(to.href);
      },
    });
  };

  const goOn = () => {
    if (!target) {
      input.current?.focus();
      setHint("Look up your profile first.");
      return;
    }
    trackOnboarding("onb_step_completed", { step: "link", ms_on_step: Math.round(performance.now() - shownAt.current) });
    if (target.kind === "confirm") router.push(target.href);
    else void advance("level");
  };

  // Continue (click, or Enter on the button) always means Continue. Enter in the username field is handled by the
  // field: Look Up until found, then Continue (implicit submission would report Continue as the submitter either way).
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (demo || busy || isSaving) return;
    goOn();
  };

  const onFieldKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (demo || busy || isSaving) return;
    if (target) goOn();
    else if (!limited) runLookup(typed);
  };

  const onType = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTyped(e.target.value);
    setHint(null);
    if (shown.kind !== "default" && shown.kind !== "validating" && shown.kind !== "rate_limited") setCard({ kind: "default" });
  };

  const skip = () => {
    if (demo || isSaving) return;
    trackOnboarding("onb_step_skipped", { step: "link" });
    void advance("level");
  };

  const connectLichess = () => {
    if (demo) return;
    setLichess({ kind: "connecting" });
    trackOnboarding("onb_link_lichess_clicked", {});
  };

  const countdown = demo ? (demoCountdown ?? "0:30") : limit.label;
  const invalid = shown.kind === "not_found" || shown.kind === "invalid";

  const whatWeImport = (
    <div className="onb-card onb-wwi" data-testid="onb-what-we-import">
      <span className="onb-lbl">What we import</span>
      <ul className="onb-check">
        <li>
          <Check aria-hidden="true" />
          <span>Your last 12 months of rated games, in the background</span>
        </li>
        <li>
          <Check aria-hidden="true" />
          <span>Ratings per time control, to pitch the coach at your level</span>
        </li>
        <li>
          <Check aria-hidden="true" />
          <span>New games every day, until you disconnect</span>
        </li>
        <li data-off="">
          <X aria-hidden="true" />
          <span>Never your password, messages or friends</span>
        </li>
      </ul>
      <p className="onb-hint">Disconnect any time in Settings · Connected accounts.</p>
    </div>
  );

  return (
    <OnbStage
      label="Link your account"
      state={shown.kind === "default" && lichess.kind === "denied" ? "lichess_denied" : shown.kind}
      testId="onb-link"
      onSubmit={onSubmit}
      aside={whatWeImport}
      inline={{ kind: "card", node: whatWeImport }}
      footer={
        <OnbFooter
          secondary={
            <Button type="button" variant="text" className="onb-skip" onClick={skip} data-testid="onb-skip">
              Skip for now
            </Button>
          }
          primary={
            <Button
              type="submit"
              size="lg"
              className="onb-primary"
              loading={isSaving}
              aria-disabled={target ? undefined : true}
              iconEnd={<ArrowRight aria-hidden="true" />}
              data-testid="onb-continue"
            >
              Continue
            </Button>
          }
        />
      }
    >
      <StepHeading>Bring your games.</StepHeading>
      <p className="onb-p">We read your public games so the coach can start from how you really play. We never ask for your password.</p>

      <section className="onb-card onb-cc" aria-labelledby="onb-cc-h" aria-busy={busy || undefined}>
        <div className="onb-cc__head">
          <h2 id="onb-cc-h" className="onb-h2">
            Chess.com
          </h2>
          <span className="onb-hint">Public games only</span>
        </div>
        <div className="onb-fld">
          <label htmlFor="cu">Chess.com username</label>
          <div className="onb-fld__row">
            <Input
              id="cu"
              ref={input}
              value={typed}
              onChange={onType}
              onKeyDown={onFieldKey}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              maxLength={25}
              enterKeyHint="go"
              // readOnly, not disabled, while the lookup runs: a disabled field drops keyboard focus, and Enter in
              // the field is how a keyboard user continues once found (regression: link-field-focus-loss,
              // e2e/specs/onboarding/keyboard.spec.ts).
              readOnly={busy}
              aria-busy={busy || undefined}
              invalid={invalid}
              aria-describedby={msgId}
              data-testid="onb-username"
            />
            <Button
              type="button"
              variant="secondary"
              className="shrink-0"
              disabled={busy}
              {...(limited ? { "aria-disabled": true as const, "aria-describedby": msgId } : {})}
              onClick={() => {
                if (!limited && !demo) runLookup(typed);
              }}
              data-testid="onb-lookup"
            >
              {busy ? <span className="onb-spin" aria-hidden="true" /> : null}
              {busy ? "Looking up…" : "Look Up Profile"}
            </Button>
          </div>
          <div id={msgId} aria-live="polite" data-testid="onb-lookup-result">
            {shown.kind === "found" ? (
              <div className="onb-found" data-testid="onb-found">
                <Check aria-hidden="true" />
                <span>
                  Found <strong>{shown.found.displayUsername}</strong>
                  {foundDetail(shown.found)}
                </span>
              </div>
            ) : null}
            {shown.kind === "not_found" ? (
              <Msg icon={<TriangleAlert aria-hidden="true" />} testId="onb-not-found">
                We couldn&apos;t find &ldquo;{shown.typed}&rdquo; on Chess.com. Check the spelling; usernames have no spaces.
              </Msg>
            ) : null}
            {shown.kind === "invalid" ? (
              <Msg icon={<TriangleAlert aria-hidden="true" />} testId="onb-invalid">
                {usernameProblem(shown.typed)}
              </Msg>
            ) : null}
            {shown.kind === "private_profile" ? (
              <Msg tone="warn" icon={<Lock aria-hidden="true" />} testId="onb-private">
                This profile is closed or its games are private, so we can&apos;t import them. You can still continue and play here
                first.
              </Msg>
            ) : null}
            {shown.kind === "rate_limited" ? (
              <Msg tone="warn" icon={<Clock aria-hidden="true" />} testId="onb-rate-limited">
                Chess.com is limiting lookups right now. Try again in{" "}
                <span className="onb-mono" role="timer" aria-live="off">
                  {countdown}
                </span>
                .
              </Msg>
            ) : null}
            {shown.kind === "linked_elsewhere" ? (
              <Msg icon={<TriangleAlert aria-hidden="true" />} testId="onb-linked-elsewhere">
                This Chess.com account is linked to another ReplayChess account. Sign in with that account, or{" "}
                <a href="/contact?topic=importing">contact us</a>.
              </Msg>
            ) : null}
            {shown.kind === "upstream" ? (
              <Msg tone="warn" icon={<TriangleAlert aria-hidden="true" />} testId="onb-upstream">
                Chess.com didn&apos;t answer. Try again in a moment.
              </Msg>
            ) : null}
            {hint ? (
              <p className="onb-hint" data-testid="onb-link-hint">
                {hint}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="onb-card onb-li" aria-labelledby="onb-li-h">
        <div className="onb-li__text">
          <h2 id="onb-li-h" className="onb-h2">
            Lichess
          </h2>
          <span className="onb-hint">Opens Lichess to approve read-only access.</span>
          {lichess.kind === "denied" ? (
            <Msg icon={<TriangleAlert aria-hidden="true" />} testId="onb-lichess-denied">
              Access wasn&apos;t approved on Lichess. Try again, or skip.
            </Msg>
          ) : null}
          {lichess.kind === "error" ? (
            <Msg icon={<TriangleAlert aria-hidden="true" />} testId="onb-lichess-error">
              {lichessErrorCopy(lichess.reason)}
            </Msg>
          ) : null}
        </div>
        {lichess.kind === "connecting" ? (
          <span className="onb-li__pending" role="status" data-testid="onb-lichess-pending">
            <span className="onb-spin" aria-hidden="true" />
            Waiting for Lichess…
          </span>
        ) : (
          <a className="onb-btn-s" href={LICHESS_START_HREF} onClick={connectLichess} data-testid="onb-connect-lichess">
            Connect Lichess
            <ArrowUpRight aria-hidden="true" />
          </a>
        )}
      </section>
    </OnbStage>
  );
}
