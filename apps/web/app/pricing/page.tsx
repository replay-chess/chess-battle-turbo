"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import { Footer } from "../components/Footer";
import { Navbar } from "../components/Navbar";
import { Bot, Video, Loader2, Check, ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUserStore } from "@/lib/stores";
import Image from "next/image";
import {
  BILLING_PLANS,
  PLAN_NAME,
  formatPrice,
  isPlanKey,
  yearlySavings,
  type PlanKey,
} from "@/lib/billing/plans";
import {
  PLAN_FEATURES,
  SALES_FAQS,
  SUBSCRIBER_FAQS,
  SUPPORT_EMAIL,
} from "@/lib/billing/copy";
import {
  BillingToggle,
  FaqAccordion,
  MembershipCard,
  PricingCard,
  useCheckout,
} from "@/app/components/billing";

const SAVINGS = yearlySavings();
const MONTHLY_PRICE = formatPrice(BILLING_PLANS.monthly.priceCents);
const YEARLY_PRICE = formatPrice(BILLING_PLANS.yearly.priceCents);

const EASE = [0.22, 1, 0.36, 1] as const;

/** How often and how many times we re-check entitlement after checkout. */
const ACTIVATION_POLL_MS = 2000;
const ACTIVATION_POLL_ATTEMPTS = 6;

type ActivationState = "idle" | "polling" | "stalled";

/** Only same-origin app paths may be used as a post-checkout destination. */
function safeRedirectPath(value: string | null): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return undefined;
  }
  return value;
}

export default function PricingPage() {
  return (
    <Suspense>
      <PricingContent />
    </Suspense>
  );
}

function PricingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Dodo appends subscription_id, status and email to the return URL.
  // Treat the redirect as informational only; entitlement comes from the
  // subscription API and webhooks, never from these query parameters.
  const checkoutSuccess =
    searchParams.get("checkout") === "success" &&
    searchParams.get("status") !== "failed";
  const checkoutFailed = searchParams.get("status") === "failed";
  const paywallRequired = searchParams.get("reason") === "required";
  const redirectUrl = safeRedirectPath(searchParams.get("redirect_url"));
  const requestedPlan = searchParams.get("plan");

  const [billing, setBilling] = useState<PlanKey>(
    isPlanKey(requestedPlan) ? requestedPlan : "yearly",
  );
  const [activation, setActivation] = useState<ActivationState>("idle");
  const redirected = useRef(false);

  const storeUser = useUserStore((s) => s.user);
  const subscription = useUserStore((s) => s.subscription);
  const fetchSubscription = useUserStore((s) => s.fetchSubscription);
  const { startCheckout, loading: checkoutLoading, error: checkoutError } =
    useCheckout();

  // `entitled` is what the server decided; older cached stores predate it and
  // only carry `plan`.
  const isSubscribed = subscription?.entitled ?? subscription?.plan === "player";

  // After a successful checkout the webhook may still be in flight, so refresh
  // right away and then keep polling for a short while.
  useEffect(() => {
    if (!checkoutSuccess) return;
    let cancelled = false;

    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const entitledNow = () => useUserStore.getState().subscription?.entitled === true;

    async function run() {
      setActivation("polling");
      await fetchSubscription();
      for (let attempt = 0; attempt < ACTIVATION_POLL_ATTEMPTS; attempt++) {
        if (cancelled || entitledNow()) break;
        await wait(ACTIVATION_POLL_MS);
        if (cancelled) break;
        await fetchSubscription();
      }
      if (cancelled) return;
      setActivation(entitledNow() ? "idle" : "stalled");
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [checkoutSuccess, fetchSubscription]);

  // Once the plan is live, send the user back to where the paywall stopped them.
  useEffect(() => {
    if (!checkoutSuccess || !redirectUrl || !isSubscribed) return;
    if (redirected.current) return;
    redirected.current = true;
    router.replace(redirectUrl);
  }, [checkoutSuccess, redirectUrl, isSubscribed, router]);

  async function handleRefresh() {
    setActivation("polling");
    await fetchSubscription();
    setActivation(
      useUserStore.getState().subscription?.entitled === true ? "idle" : "stalled",
    );
  }

  function handleSubscribe() {
    void startCheckout(billing, { returnPath: redirectUrl });
  }

  if (isSubscribed) {
    const isMonthlyMember = subscription?.subscription?.interval === "month";
    return (
      <div className="min-h-screen bg-cb-bg text-cb-text">
        <Navbar />

        {/* Subscriber Hero */}
        <section className="relative pt-32 pb-20 overflow-hidden">
          <div
            className="absolute inset-0 opacity-[0.015]"
            style={{
              backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
              backgroundSize: "80px 80px",
            }}
          />
          <div className="relative z-10 max-w-3xl mx-auto px-4 text-center">
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, ease: EASE }}
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-6"
            >
              Membership
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: EASE }}
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-5xl sm:text-6xl md:text-7xl mb-4 text-cb-text"
            >
              {storeUser?.name
                ? `Welcome back, ${storeUser.name.split(" ")[0]}`
                : "Your Membership"}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-lg text-cb-text-muted"
            >
              Manage your {PLAN_NAME} plan and billing details.
            </motion.p>
          </div>
        </section>

        <div className="relative">
          <main className="max-w-3xl mx-auto px-4 sm:px-6 pb-20">
            {/* Checkout success banner */}
            {checkoutSuccess && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-8"
              >
                <div
                  className="border border-amber-500/30 bg-amber-500/10 p-4 text-center"
                  data-testid="checkout-success-banner"
                >
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm text-amber-400"
                  >
                    Payment successful! Your subscription is now active.
                  </p>
                </div>
              </motion.div>
            )}

            {/* Already subscribed but sent here by the paywall: offer the way back. */}
            {!checkoutSuccess && paywallRequired && redirectUrl && (
              <div className="mb-8 border border-cb-border bg-cb-hover p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-sm text-cb-text-secondary"
                >
                  Your {PLAN_NAME} plan is active. You can head straight back.
                </p>
                <a
                  href={redirectUrl}
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-cb-accent text-cb-accent-fg hover:bg-cb-accent/90 transition-colors"
                >
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            )}

            {/* Membership Status Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2, ease: EASE }}
              className="mb-12"
            >
              <MembershipCard
                subscription={subscription}
                customerId={subscription?.customerId}
              />
              {isMonthlyMember && storeUser?.referenceId && (
                <a
                  href={`/profile/${storeUser.referenceId}#membership`}
                  data-testid="switch-to-yearly-hint"
                  className="group mt-4 flex items-center justify-between border border-amber-500/30 bg-amber-500/10 p-4 hover:bg-amber-500/15 transition-colors"
                >
                  <span
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm text-amber-400"
                  >
                    Switch to yearly and save {SAVINGS.percent}%
                  </span>
                  <ArrowRight className="w-4 h-4 text-amber-400 group-hover:translate-x-0.5 transition-transform" />
                </a>
              )}
            </motion.div>

            {/* Feature Access Grid */}
            <motion.section
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.35, ease: EASE }}
              className="mb-20"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent to-cb-border" />
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted"
                >
                  Your Access
                </p>
                <div className="flex-1 h-px bg-gradient-to-l from-transparent to-cb-border" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-cb-hover">
                {PLAN_FEATURES.map((feature, index) => (
                  <motion.div
                    key={feature}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.5,
                      delay: 0.4 + index * 0.06,
                      ease: EASE,
                    }}
                    className="bg-cb-bg p-5"
                  >
                    <div className="flex items-center justify-center w-8 h-8 border border-amber-500/20 bg-amber-500/5 mb-3">
                      <Check className="w-3.5 h-3.5 text-amber-400" />
                    </div>
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-sm text-cb-text-secondary mb-0.5"
                    >
                      {feature}
                    </p>
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-[11px] text-cb-text-muted"
                    >
                      Included
                    </p>
                  </motion.div>
                ))}
              </div>
            </motion.section>

            {/* Subscriber FAQ */}
            <section className="mb-20">
              <FaqAccordion items={SUBSCRIBER_FAQS} heading="Subscription FAQ" />
            </section>
          </main>

          <Footer />
        </div>
      </div>
    );
  }

  // Non-subscriber sales page
  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar />

      {/* Hero Section */}
      <section className="relative h-[60vh] min-h-[500px] w-full overflow-hidden">
        <Image
          src="/og-image.jpg"
          alt=""
          aria-hidden="true"
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-20 grayscale"
        />

        {/* Gradient overlays */}
        <div className="absolute inset-0 bg-gradient-to-b from-cb-gradient-from via-transparent to-cb-gradient-from" />
        <div className="absolute inset-0 bg-gradient-to-r from-cb-backdrop via-transparent to-cb-backdrop" />

        {/* Subtle grid background */}
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
            backgroundSize: "80px 80px",
          }}
        />

        <div className="relative z-10 h-full flex flex-col items-center justify-center text-center px-4">
          <motion.h1
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="text-6xl sm:text-7xl md:text-8xl lg:text-9xl mb-6 text-cb-text"
          >
            Chess Training Plans and Pricing
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-lg sm:text-xl md:text-2xl text-cb-text-muted max-w-2xl"
          >
            All-in-one chess creation suite. Powered by AI.
          </motion.p>
        </div>
      </section>

      {/* Main Content */}
      <div className="relative">
        <main>
          <section className="py-10">
            <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-md text-cb-text-muted mb-8 mx-auto"
              >
                Game Recorder, Position Editor, AI Assistant, Voice Coach,
                Analysis Generator - all in one powerful package.
              </motion.p>
            </div>

            {/* Paywall banner */}
            {paywallRequired && !checkoutSuccess && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-md mx-auto mb-8 px-4"
              >
                <div
                  role="status"
                  data-testid="paywall-banner"
                  className="border border-amber-500/30 bg-amber-500/10 p-4 text-center"
                >
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm text-amber-400"
                  >
                    A {PLAN_NAME} plan is required to play. Pick a plan and
                    you&apos;ll be sent straight back.
                  </p>
                </div>
              </motion.div>
            )}

            {/* Checkout success: activating / stalled */}
            {checkoutSuccess && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-md mx-auto mb-8 px-4"
              >
                <div
                  role="status"
                  data-testid="checkout-activating-banner"
                  className="border border-amber-500/30 bg-amber-500/10 p-4 text-center"
                >
                  {activation === "stalled" ? (
                    <>
                      <p
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-sm text-amber-400"
                      >
                        Payment received. Your plan is activating, this can take
                        a minute.
                      </p>
                      <button
                        type="button"
                        onClick={handleRefresh}
                        data-testid="activation-refresh"
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="mt-3 px-4 py-2 text-xs font-medium uppercase tracking-widest border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 transition-colors"
                      >
                        Refresh
                      </button>
                    </>
                  ) : (
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-sm text-amber-400 flex items-center justify-center gap-2"
                    >
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Payment successful! Your subscription is being activated.
                    </p>
                  )}
                </div>
              </motion.div>
            )}

            {checkoutFailed && (
              <div className="max-w-md mx-auto mb-8 px-4">
                <div
                  role="alert"
                  data-testid="checkout-failed-banner"
                  className="border border-red-500/30 bg-red-500/10 p-4 text-center"
                >
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm text-red-400"
                  >
                    Your payment did not go through. You have not been charged.
                    Pick a plan below to try again.
                  </p>
                </div>
              </div>
            )}

            {/* Billing interval toggle */}
            <div className="flex justify-center mb-8 px-4">
              <BillingToggle value={billing} onChange={setBilling} />
            </div>

            {/* Single Player Pricing Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="max-w-md mx-auto px-4 sm:px-6"
            >
              <PricingCard
                plan={billing}
                onSubscribe={handleSubscribe}
                loading={checkoutLoading}
                error={checkoutError}
                isSignedIn={!!storeUser}
              />
            </motion.div>

            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-sm text-cb-text-muted text-center mt-8 mb-8 max-w-xl mx-auto p-4"
            >
              Review the included features and billing FAQs before subscribing.
              Questions can be sent to {SUPPORT_EMAIL}.
            </p>
          </section>
        </main>

        {/* Features Table */}
        <section className="py-20">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-3xl sm:text-4xl lg:text-5xl mb-12 text-center text-cb-text"
            >
              What&apos;s Included
            </h2>
            <div className="overflow-x-auto border border-cb-border">
              <table className="w-full overflow-hidden text-sm">
                <thead>
                  <tr>
                    <th className="p-4 text-left bg-cb-hover"></th>
                    <th className="p-4 text-center bg-cb-hover">
                      <h3
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-sm font-medium text-cb-text mb-2"
                      >
                        {PLAN_NAME}
                      </h3>
                      <p
                        style={{ fontFamily: "'Instrument Serif', serif" }}
                        className="text-xl text-cb-text-secondary"
                      >
                        {MONTHLY_PRICE}/mo
                      </p>
                      <p
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-xs text-cb-text-muted mt-1"
                      >
                        or {YEARLY_PRICE}/yr
                      </p>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td
                      colSpan={2}
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="p-4 text-xs uppercase tracking-widest font-medium text-cb-text-secondary bg-cb-hover flex items-center gap-2"
                    >
                      Chess Tools <Video className="w-3 h-3" />
                    </td>
                  </tr>
                  {[
                    { label: "Positions", value: "Unlimited" },
                    { label: "Record & Export", value: "✓" },
                    { label: "Quality", value: "1080p" },
                    { label: "Recording Length", value: "15 mins" },
                  ].map((row) => (
                    <tr key={row.label} className="border-t border-cb-border">
                      <td
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="p-4 text-cb-text-muted bg-cb-hover"
                      >
                        {row.label}
                      </td>
                      <td
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="p-4 text-center text-cb-text-muted bg-cb-hover"
                      >
                        {row.value}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td
                      colSpan={2}
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="p-4 text-xs uppercase tracking-widest font-medium text-cb-text-secondary bg-cb-hover flex items-center gap-2"
                    >
                      AI Features <Bot className="w-3 h-3" />
                    </td>
                  </tr>
                  {[{ label: "AI Analysis", value: "Basic" }].map((row) => (
                    <tr key={row.label} className="border-t border-cb-border">
                      <td
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="p-4 text-cb-text-muted bg-cb-hover"
                      >
                        {row.label}
                      </td>
                      <td
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="p-4 text-center text-cb-text-muted bg-cb-hover"
                      >
                        {row.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-20">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <FaqAccordion items={SALES_FAQS} heading="Frequently Asked Questions" />
          </div>
        </section>

        {/* Footer */}
        <Footer />
      </div>
    </div>
  );
}
