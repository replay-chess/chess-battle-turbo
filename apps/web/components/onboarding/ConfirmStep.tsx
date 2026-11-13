"use client";

// Confirm `/onboarding/confirm?provider=chesscom&u=…|lichess` (phase-04 plan §4.3; V3OnbPreview, V3iPhoneOnbPreview,
// V3iPadOnbPreview). States: `loading` (the Suspense fallback while getAccountPreview runs: skeletons, That's Me
// aria-disabled), `default`, `no_games`; undrawn: recent games failed (partial render), the provider not answering.
//
// That's Me: Chess.com → ACC-3 `POST /api/accounts/chesscom {context: "onboarding"}` with the mount's Idempotency-Key
// (the link also advances the step to LEVEL server-side, D4-15) → Level; a 409 linked_elsewhere (race) → Link with
// the reason. Lichess (already linked by the OAuth callback) → advance("level"). Not Me: Chess.com → Link with the
// input cleared and focused; Lichess → ACC-6 removes the link (no token exists, D4-21) → Link. Keyboard: Enter =
// That's Me (the form), Esc = Not Me when focus is not in a field.
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowRight, TriangleAlert } from "lucide-react";
import type { LookupData } from "@repo/contracts/http/accounts";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { useRetryCountdown } from "@/components/system/useRetryCountdown";
import { useLinkChessCom, useUnlinkAccount } from "@/lib/api/mutations/accounts";
import { useOnboardingStep } from "@/lib/api/mutations/onboarding";
import { initialsOf } from "@/lib/onboarding/display-name";
import { formatCount } from "@/lib/onboarding/link-state";
import { profileSubline, ratingTiles, resultTag, type ProviderSlugLike } from "@/lib/onboarding/confirm-view";
import { stepPath } from "@/lib/onboarding/steps";
import { gamesBucket, trackOnboarding } from "@/lib/onboarding/telemetry";
import { OnbFooter, OnbStage, StepHeading } from "./OnbStage";

// Off the default path (private or no games, a refused link): loaded only when shown, server-rendered when the page
// opens in that state (FIX-2, plan §9.6: the step's First Load JS ≤ 140 kB).
const Banner = dynamic(() => import("@/components/ui/banner").then((m) => m.Banner));

/** A recent game as the aside shows it (labels formatted on the server). */
export type RecentRow = {
  result: "win" | "loss" | "draw";
  opponentName: string;
  opponentRating: number | null;
  openingName: string | null;
  dayLabel: string;
};

export type ConfirmView =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "ready"; account: LookupData; recent: RecentRow[] | null };

export type ConfirmStepProps = {
  provider: ProviderSlugLike;
  /** Chess.com: the handle from `?u=` (as typed). Lichess: null. */
  username: string | null;
  view: ConfirmView;
  demo?: boolean;
};

const LINK_RETRY_HREF = `${stepPath("link")}?retry=1`;

export function confirmState(view: ConfirmView): "loading" | "default" | "no_games" | "private" | "unavailable" {
  if (view.state !== "ready") return view.state;
  if (view.account.status === "private") return "private";
  return view.account.totalRatedGames > 0 ? "default" : "no_games";
}

function ProfileCard({ provider, account }: { provider: ProviderSlugLike; account: LookupData }) {
  const name = account.profile.displayUsername;
  const games = account.totalRatedGames;
  return (
    <div className="onb-card onb-acct" data-testid="onb-profile-card">
      <div className="onb-acct__who">
        {/* Initials only until the Chess.com terms review clears (D4-26). */}
        <span className="onb-av" aria-hidden="true">
          {initialsOf(name)}
        </span>
        <div className="onb-acct__name">
          <span>{name}</span>
          <span className="onb-sec onb-small">
            {profileSubline(provider, account.profile.joinedAt, account.profile.countryCode)}
          </span>
        </div>
      </div>
      <dl className="onb-ratings">
        {ratingTiles(provider, account.ratings).map((t) => (
          <div key={t.label}>
            <dt>{t.label}</dt>
            <dd>{t.value}</dd>
          </div>
        ))}
      </dl>
      {account.status === "private" ? (
        <Banner tone="warn" live="off">
          This profile is closed or its games are private, so we can&apos;t import them. You can still continue and play here first.
        </Banner>
      ) : games > 0 ? (
        <div className="onb-row-between">
          <span className="onb-sec">Rated games</span>
          <span className="onb-mono" data-testid="onb-rated-games">
            {formatCount(games)}
          </span>
        </div>
      ) : (
        <Banner tone="info" icon={false} live="off" data-testid="onb-no-games">
          No rated games yet. The coach will start from your first game here.
        </Banner>
      )}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <SkeletonRegion label="Loading the profile" className="onb-card onb-acct">
      <div className="onb-acct__who">
        <Skeleton shape="circle" className="size-14" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-2.5 w-[70%]" />
        </div>
      </div>
      <Skeleton className="h-14" />
      <Skeleton className="h-3" />
    </SkeletonRegion>
  );
}

function RecentGames({ view }: { view: ConfirmView }) {
  const total = view.state === "ready" ? view.account.totalRatedGames : null;
  return (
    <section className="onb-card" aria-label="Most recent games" data-testid="onb-recent-games">
      <div className="onb-rg__head">
        <span className="onb-lbl">Most recent games</span>
        {total !== null && total > 0 ? <span className="onb-mono onb-sec onb-xs">of {formatCount(total)}</span> : null}
      </div>
      {view.state === "loading" ? (
        <div className="onb-rg__sk" aria-hidden="true">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : view.state === "unavailable" ? (
        <p className="onb-rg__empty">Couldn&apos;t load recent games.</p>
      ) : view.account.totalRatedGames === 0 || view.account.status === "private" ? (
        <p className="onb-rg__empty">Nothing to import yet.</p>
      ) : view.recent === null ? (
        <p className="onb-rg__empty" data-testid="onb-recent-failed">
          Couldn&apos;t load recent games.
        </p>
      ) : view.recent.length === 0 ? (
        <p className="onb-rg__empty">No recent rated games.</p>
      ) : (
        <ul className="onb-rg">
          {view.recent.map((g, i) => (
            <li key={i}>
              <span className="onb-rg__res" data-r={g.result}>
                {resultTag(g.result)}
              </span>
              <span className="onb-rg__who">
                <span>
                  {g.opponentName}{" "}
                  {g.opponentRating !== null ? (
                    <span className="onb-mono onb-sec onb-xs">
                      ({g.opponentRating})
                    </span>
                  ) : null}
                </span>
                {g.openingName ? (
                  <span className="onb-sec onb-xs">
                    {g.openingName}
                  </span>
                ) : null}
              </span>
              <span className="onb-mono onb-sec onb-xs" data-vr-mask="">
                {g.dayLabel}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

export function ConfirmStep({ provider, username, view, demo = false }: ConfirmStepProps) {
  const router = useRouter();
  const { advance, isSaving } = useOnboardingStep();
  const link = useLinkChessCom("onboarding");
  const unlink = useUnlinkAccount("lichess");
  const limit = useRetryCountdown(link, { routeId: "accounts.chesscom.link" });
  const [problem, setProblem] = useState<string | null>(null);
  const shownAt = useRef(0);
  const viewed = useRef(false);
  const state = confirmState(view);
  const ready = view.state === "ready";
  const busy = link.isPending || unlink.isPending || isSaving;

  useEffect(() => {
    shownAt.current = performance.now();
    if (demo) return;
    trackOnboarding("onb_step_viewed", { step: "confirm" });
  }, [demo]);

  useEffect(() => {
    if (demo || viewed.current || view.state !== "ready") return;
    viewed.current = true;
    trackOnboarding("onb_confirm_viewed", { provider, games_bucket: gamesBucket(view.account.totalRatedGames) });
    // No prefetch of Level here: the stored step is still LINK, so the guard's answer for /onboarding/level is a
    // redirect to the stored step, and a production build would replay that cached redirect after That's Me
    // (regression: confirm-level-prefetch, e2e/specs/onboarding/resume-and-guards.spec.ts).
  }, [demo, provider, view]);

  const accept = () => {
    if (demo || busy || !ready) return;
    setProblem(null);
    trackOnboarding("onb_confirm_accepted", { provider });
    trackOnboarding("onb_step_completed", { step: "confirm", ms_on_step: Math.round(performance.now() - shownAt.current) });
    if (provider === "lichess" || view.account.status === "private") {
      // Lichess was linked by the OAuth callback; a private Chess.com profile is not linked (nothing to import).
      void advance("level");
      return;
    }
    if (limit.limited || !username) return;
    link.mutate(username, {
      onSuccess: () => router.push(stepPath("level")),
      onError: (err: unknown) => {
        const e = err as { code?: string; details?: Record<string, unknown> };
        if (e.code === "conflict" && e.details?.reason === "linked_elsewhere") {
          router.replace(`${stepPath("link")}?error=linked_elsewhere`);
        } else if (e.code === "not_found") {
          router.replace(`${stepPath("link")}?error=not_found&u=${encodeURIComponent(username)}`);
        } else if (e.code === "rate_limited") {
          setProblem(null);
        } else {
          setProblem(provider === "chesscom" ? "Chess.com didn't answer. Try again in a moment." : "Couldn't link the account. Try again.");
        }
      },
    });
  };

  const notMe = () => {
    if (demo || busy) return;
    trackOnboarding("onb_confirm_not_me", { provider });
    if (provider === "lichess") {
      unlink.mutate(
        { deleteGames: false },
        {
          onSuccess: () => router.push(LINK_RETRY_HREF),
          onError: () => setProblem("Couldn't remove the Lichess link. Try again."),
        },
      );
      return;
    }
    router.push(LINK_RETRY_HREF);
  };

  useEffect(() => {
    if (demo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      notMe();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    accept();
  };

  const recent = <RecentGames view={view} />;

  return (
    <OnbStage
      label="Confirm your account"
      state={state}
      testId="onb-confirm"
      onSubmit={onSubmit}
      aside={recent}
      inline={{ kind: "card", node: recent }}
      footer={
        <OnbFooter
          secondary={
            <Button type="button" variant="secondary" className="onb-secondary" onClick={notMe} disabled={unlink.isPending} data-testid="onb-not-me">
              Not Me
            </Button>
          }
          primary={
            <Button
              type="submit"
              size="lg"
              className="onb-primary"
              loading={link.isPending || isSaving}
              aria-disabled={!ready || limit.limited || undefined}
              iconEnd={<ArrowRight aria-hidden="true" />}
              data-testid="onb-thats-me"
            >
              That&apos;s Me
            </Button>
          }
        />
      }
    >
      <StepHeading>Is this you?</StepHeading>
      <p className="onb-p">
        Check the profile before we import. Importing starts as soon as your trial begins, and runs in the background.
      </p>
      {view.state === "loading" ? <ProfileSkeleton /> : null}
      {view.state === "ready" ? <ProfileCard provider={provider} account={view.account} /> : null}
      {view.state === "unavailable" ? (
        <Banner
          tone="warn"
          live="polite"
          data-testid="onb-confirm-unavailable"
          action={
            <Button type="button" size="sm" variant="secondary" onClick={() => router.refresh()}>
              Try Again
            </Button>
          }
        >
          {provider === "chesscom" ? "Chess.com" : "Lichess"} didn&apos;t answer. Try again in a moment.
        </Banner>
      ) : null}
      <div aria-live="polite">
        {limit.limited ? (
          <p className="onb-msg" data-tone="warn" data-testid="onb-link-limited">
            <TriangleAlert aria-hidden="true" />
            <span>
              Too many attempts. Try again in <span className="onb-mono">{limit.label}</span>.
            </span>
          </p>
        ) : null}
        {problem ? (
          <p className="onb-msg" data-testid="onb-confirm-problem">
            <TriangleAlert aria-hidden="true" />
            <span>{problem}</span>
          </p>
        ) : null}
      </div>
    </OnbStage>
  );
}
