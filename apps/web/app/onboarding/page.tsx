"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { Check, ExternalLink, Loader2, Search } from "lucide-react";
import { ChessComPreviewCard } from "../components/ChessComPreviewCard";
import type { ChessComPreviewData } from "@/lib/types/chess-com";
import { useUserStore, type StoreSubscription, type StoreUser } from "@/lib/stores";
import { PLAN_NAME, isPlanKey, type PlanKey } from "@/lib/billing/plans";
import { BillingToggle, PricingCard, useCheckout } from "@/app/components/billing";

/**
 * Onboarding state machine.
 *
 *   plan    -> pick a billing interval and pay (skipped when already entitled)
 *   input   -> enter a chess.com username
 *   preview -> confirm the chess.com profile (back returns to input)
 *   done    -> profile saved or skipped, heading to /play
 *
 * `step` only ever moves forward through user actions; entitlement is layered
 * on top: while `step` is still "plan" and the store says the user may play,
 * the page renders "input" instead. That single rule covers returning users
 * who arrive already entitled and users whose plan activates after checkout.
 */
type Step = "plan" | "input" | "preview" | "done";

/** What the post-checkout activation check is doing. */
type ActivationState = "idle" | "polling" | "stalled";

const EASE = [0.22, 1, 0.36, 1] as const;

/** How often and how many times we re-check entitlement after checkout. */
const ACTIVATION_POLL_MS = 2000;
const ACTIVATION_POLL_ATTEMPTS = 6;

const DESTINATION_AFTER_ONBOARDING = "/play";

/**
 * Whether the user may play according to what the store already knows.
 * Admins and a switched-off paywall never see the plan step. Returns null
 * while the answer is not known yet (subscription not fetched).
 */
function resolveEntitled(
  user: StoreUser | null,
  subscription: StoreSubscription | null,
): boolean | null {
  if (user?.role === "ADMIN") return true;
  if (subscription === null) return null;
  if (subscription.paywall === false) return true;
  // `entitled` is what the server decided; older cached stores predate it and
  // only carry `plan`.
  return subscription.entitled ?? subscription.plan === "player";
}

function storeSaysEntitled(): boolean {
  const state = useUserStore.getState();
  return resolveEntitled(state.user, state.subscription) === true;
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <OnboardingContent />
    </Suspense>
  );
}

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, isSignedIn } = useUser();

  const requestedPlan = searchParams.get("plan");
  // Dodo appends subscription_id, status and email to the return URL. Treat
  // them as informational only; entitlement comes from the subscription API.
  const checkoutFailed = searchParams.get("status") === "failed";
  const checkoutSuccess = searchParams.get("checkout") === "success" && !checkoutFailed;

  const storeUser = useUserStore((s) => s.user);
  const subscription = useUserStore((s) => s.subscription);
  const isSyncing = useUserStore((s) => s.isSyncing);
  const fetchSubscription = useUserStore((s) => s.fetchSubscription);
  const { startCheckout, loading: checkoutLoading, error: checkoutError } =
    useCheckout();

  const [step, setStep] = useState<Step>("plan");
  const [billing, setBilling] = useState<PlanKey>(
    isPlanKey(requestedPlan) ? requestedPlan : "yearly",
  );
  const [activation, setActivation] = useState<ActivationState>(
    checkoutSuccess ? "polling" : "idle",
  );
  const [chessComHandle, setChessComHandle] = useState("");
  const [previewData, setPreviewData] = useState<ChessComPreviewData | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestedSubscription = useRef(false);

  const entitled = resolveEntitled(storeUser, subscription);
  // Entitled users never see the plan step, whether they arrived that way or
  // their plan just activated.
  const currentStep: Step = step === "plan" && entitled === true ? "input" : step;

  // Signed-out visitors cannot pay or connect anything; send them to sign in
  // and bring them straight back here.
  useEffect(() => {
    if (!isLoaded || isSignedIn) return;
    const next = isPlanKey(requestedPlan) ? `/onboarding?plan=${requestedPlan}` : "/onboarding";
    router.replace(`/sign-in?redirect_url=${encodeURIComponent(next)}`);
  }, [isLoaded, isSignedIn, requestedPlan, router]);

  // UserSync normally fetches the subscription right after sign-in. Ask for it
  // ourselves once if the store still has nothing and no fetch is in flight
  // (a reload of this page with a stale persisted store, for example).
  useEffect(() => {
    if (!storeUser || subscription !== null || isSyncing) return;
    if (requestedSubscription.current) return;
    requestedSubscription.current = true;
    void fetchSubscription();
  }, [storeUser, subscription, isSyncing, fetchSubscription]);

  // After a successful checkout the webhook may still be in flight, so refresh
  // right away and then keep polling for a short while.
  useEffect(() => {
    if (!checkoutSuccess) return;
    let cancelled = false;

    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    async function run() {
      setActivation("polling");
      await fetchSubscription();
      for (let attempt = 0; attempt < ACTIVATION_POLL_ATTEMPTS; attempt++) {
        if (cancelled || storeSaysEntitled()) break;
        await wait(ACTIVATION_POLL_MS);
        if (cancelled) break;
        await fetchSubscription();
      }
      if (cancelled) return;
      setActivation(storeSaysEntitled() ? "idle" : "stalled");
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [checkoutSuccess, fetchSubscription]);

  async function handleRetryActivation() {
    setActivation("polling");
    await fetchSubscription();
    setActivation(storeSaysEntitled() ? "idle" : "stalled");
  }

  function handleSubscribe() {
    void startCheckout(billing, { returnPath: `/onboarding?plan=${billing}` });
  }

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!chessComHandle.trim()) {
      setError("Please enter your chess.com username");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/user/chess-com-profile/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chessComHandle: chessComHandle.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to look up chess.com profile");
      }

      setPreviewData(data.data);
      setStep("preview");
    } catch (err) {
      logger.error("Preview error", err);
      setError(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/user/chess-com-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chessComHandle: chessComHandle.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save chess.com profile");
      }

      setStep("done");
      router.push(DESTINATION_AFTER_ONBOARDING);
    } catch (err) {
      logger.error("Confirm error", err);
      setError(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
      setSaving(false);
    }
  };

  const handleGoBack = () => {
    setStep("input");
    setPreviewData(null);
    setError(null);
  };

  const handleSkip = async () => {
    setStep("done");
    try {
      await fetch("/api/user/onboarding-skip", { method: "POST" });
    } catch {
      // Don't block navigation on skip failure
    }
    router.push(DESTINATION_AFTER_ONBOARDING);
  };

  // Wait for Clerk, the synced user, and (unless already known) the
  // subscription before choosing a first step, so the plan card never
  // flashes for a paying member.
  const booting =
    !isLoaded || !isSignedIn || !storeUser || (entitled === null && !checkoutSuccess);

  if (booting) {
    return <LoadingScreen />;
  }

  return (
    <div className="min-h-screen bg-cb-bg flex items-center justify-center p-4 relative">
      {/* Subtle grid background */}
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 max-w-md w-full">
        <AnimatePresence mode="wait">
          {currentStep === "plan" && (
            <motion.div
              key="plan"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="border border-cb-border p-8 sm:p-10"
              data-testid="onboarding-plan-step"
            >
              <StepIndicator current="plan" />

              {/* Header */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-center mb-8"
              >
                <h1
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-3xl sm:text-4xl text-cb-text mb-3"
                >
                  Welcome to ReplayChess
                </h1>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-cb-text-muted"
                >
                  A {PLAN_NAME} plan is needed to play. Pick how you&apos;d like
                  to be billed.
                </p>
              </motion.div>

              {activation === "polling" && (
                <div
                  role="status"
                  data-testid="onboarding-activating"
                  className="border border-amber-500/30 bg-amber-500/10 p-6 text-center"
                >
                  <Loader2 className="w-5 h-5 animate-spin text-amber-400 mx-auto mb-3" />
                  <p
                    style={{ fontFamily: "'Instrument Serif', serif" }}
                    className="text-2xl text-cb-text mb-1"
                  >
                    Activating your plan
                  </p>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm text-amber-400"
                  >
                    Payment successful. This usually takes a few seconds.
                  </p>
                </div>
              )}

              {activation === "stalled" && (
                <div
                  role="status"
                  data-testid="onboarding-activation-stalled"
                  className="border border-amber-500/30 bg-amber-500/10 p-6 text-center"
                >
                  <p
                    style={{ fontFamily: "'Instrument Serif', serif" }}
                    className="text-2xl text-cb-text mb-2"
                  >
                    Payment received
                  </p>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm text-amber-400"
                  >
                    Activation is taking longer than usual. You have not been
                    charged twice; your plan will appear as soon as the payment
                    provider confirms it.
                  </p>
                  <button
                    type="button"
                    onClick={handleRetryActivation}
                    data-testid="onboarding-activation-retry"
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="mt-4 px-4 py-2 text-xs font-medium uppercase tracking-widest border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 transition-colors"
                  >
                    Retry
                  </button>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="mt-4 text-xs text-cb-text-muted"
                  >
                    Still stuck?{" "}
                    <Link
                      href="/pricing"
                      className="underline underline-offset-4 hover:text-cb-text-secondary transition-colors"
                    >
                      Check your membership on the pricing page
                    </Link>
                  </p>
                </div>
              )}

              {activation === "idle" && (
                <>
                  {checkoutFailed && (
                    <div
                      role="alert"
                      data-testid="onboarding-checkout-failed"
                      className="border border-red-500/30 bg-red-500/10 p-4 text-center mb-6"
                    >
                      <p
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-sm text-red-400"
                      >
                        Your payment did not go through. You have not been
                        charged. Pick a plan to try again.
                      </p>
                    </div>
                  )}

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="flex justify-center mb-6"
                  >
                    <BillingToggle value={billing} onChange={setBilling} />
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                  >
                    <PricingCard
                      plan={billing}
                      onSubscribe={handleSubscribe}
                      loading={checkoutLoading}
                      error={checkoutError}
                      isSignedIn
                      compact
                    />
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="text-center pt-6"
                  >
                    <Link
                      href="/try"
                      data-testid="onboarding-browse-free"
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="inline-flex items-center gap-1 text-xs text-cb-text-muted hover:text-cb-text-secondary transition-colors"
                    >
                      Just browsing? Explore free positions
                    </Link>
                  </motion.div>
                </>
              )}
            </motion.div>
          )}

          {currentStep === "input" && (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="border border-cb-border p-8 sm:p-12"
              data-testid="onboarding-input-step"
            >
              <StepIndicator current="input" />

              {/* Header */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-center mb-10"
              >
                <h1
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-3xl sm:text-4xl text-cb-text mb-3"
                >
                  Welcome to ReplayChess
                </h1>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-cb-text-muted"
                >
                  Connect your chess.com account
                </p>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-xs text-cb-text-faint mt-2"
                >
                  You can add this later from your profile
                </p>
              </motion.div>

              <form onSubmit={handleLookup} className="space-y-6">
                {/* Input */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <label
                    htmlFor="chessComHandle"
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="block text-xs text-cb-text-muted uppercase tracking-widest mb-3"
                  >
                    Chess.com Username
                  </label>
                  <input
                    type="text"
                    id="chessComHandle"
                    value={chessComHandle}
                    onChange={(e) => setChessComHandle(e.target.value)}
                    placeholder="e.g., hikaru"
                    className={cn(
                      "w-full px-4 py-3 bg-transparent border border-cb-border",
                      "text-cb-text placeholder-cb-text-faint",
                      "focus:outline-none focus:border-cb-border-strong transition-colors duration-300"
                    )}
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    disabled={loading}
                  />
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="mt-2 text-xs text-cb-text-faint"
                  >
                    We&apos;ll fetch your ratings and stats from chess.com
                  </p>
                </motion.div>

                {/* Error */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border border-cb-border-strong p-4"
                  >
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-cb-text-secondary text-sm"
                    >
                      {error}
                    </p>
                  </motion.div>
                )}

                {/* Buttons */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="space-y-3"
                >
                  <button
                    type="submit"
                    disabled={loading}
                    className={cn(
                      "group relative w-full flex items-center justify-center gap-2 px-8 py-4",
                      "bg-cb-accent text-cb-accent-fg",
                      "transition-all duration-300 overflow-hidden",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                    style={{ fontFamily: "'Geist', sans-serif" }}
                  >
                    <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                    <span className="relative z-10 font-medium group-hover:text-cb-text transition-colors duration-300">
                      {loading ? "Looking up..." : "Look Up Profile"}
                    </span>
                    {!loading && (
                      <Search
                        className="w-4 h-4 relative z-10 group-hover:text-cb-text transition-colors duration-300"
                        strokeWidth={1.5}
                      />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleSkip}
                    disabled={loading}
                    className={cn(
                      "group w-full flex items-center justify-center gap-2 px-8 py-4",
                      "border border-cb-border hover:border-cb-border-strong",
                      "text-cb-text-secondary hover:text-cb-text transition-all duration-300",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                    style={{ fontFamily: "'Geist', sans-serif" }}
                  >
                    Skip for Now
                  </button>
                </motion.div>

                {/* Link to chess.com */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="text-center pt-4"
                >
                  <a
                    href="https://www.chess.com/register"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="inline-flex items-center gap-1 text-xs text-cb-text-muted hover:text-cb-text-secondary transition-colors"
                  >
                    Don&apos;t have an account? Create one
                    <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                  </a>
                </motion.div>
              </form>
            </motion.div>
          )}

          {currentStep === "preview" && previewData && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4, ease: EASE }}
              data-testid="onboarding-preview-step"
            >
              <StepIndicator current="input" />

              {/* Preview header */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center mb-6"
              >
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-cb-text-muted text-sm"
                >
                  Is this your account?
                </p>
              </motion.div>

              <ChessComPreviewCard
                previewData={previewData}
                onConfirm={handleConfirm}
                onCancel={handleGoBack}
                loading={saving}
                confirmLabel="Confirm & Connect"
              />

              {/* Error on confirm */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="border border-cb-border-strong p-4 mt-4"
                >
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-cb-text-secondary text-sm"
                  >
                    {error}
                  </p>
                </motion.div>
              )}
            </motion.div>
          )}

          {currentStep === "done" && (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="border border-cb-border p-8 sm:p-12 text-center"
              data-testid="onboarding-done-step"
            >
              <Loader2 className="w-5 h-5 animate-spin text-cb-text-muted mx-auto mb-4" />
              <p
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-2xl text-cb-text mb-2"
              >
                You&apos;re all set
              </p>
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-sm text-cb-text-muted"
              >
                Taking you to the board...
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const STEPS: { key: "plan" | "input"; label: string }[] = [
  { key: "plan", label: "Plan" },
  { key: "input", label: "Chess.com" },
];

/** "1 Plan / 2 Chess.com" eyebrow. Completed steps turn amber. */
function StepIndicator({ current }: { current: "plan" | "input" }) {
  const currentIndex = STEPS.findIndex((s) => s.key === current);
  return (
    <ol
      aria-label="Onboarding steps"
      data-testid="onboarding-steps"
      style={{ fontFamily: "'Geist', sans-serif" }}
      className="flex items-center justify-center gap-3 mb-8 text-[10px] tracking-[0.3em] uppercase text-cb-text-muted"
    >
      {STEPS.map((s, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li key={s.key} className="flex items-center gap-3">
            {index > 0 && <span className="h-px w-6 bg-cb-border" aria-hidden />}
            <span
              aria-current={active ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5",
                active && "text-cb-text",
                done && "text-amber-400",
              )}
            >
              {done ? (
                <Check className="w-3 h-3" strokeWidth={2} aria-hidden />
              ) : (
                <span style={{ fontFamily: "'Geist Mono', monospace" }}>{index + 1}</span>
              )}
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-cb-bg flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center gap-4"
      >
        <div className="w-12 h-12 border-2 border-cb-border-strong border-t-cb-text rounded-full animate-spin" />
        <p
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="text-cb-text-muted text-sm tracking-wide"
        >
          Loading...
        </p>
      </motion.div>
    </div>
  );
}
