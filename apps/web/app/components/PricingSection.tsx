"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, Check } from "lucide-react";
import { useUserStore } from "@/lib/stores";
import { PLAN_NAME, type PlanKey } from "@/lib/billing/plans";
import { checkoutReturnPath } from "@/lib/billing/client";
import { BillingToggle, PricingCard, useCheckout } from "@/app/components/billing";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Where a visitor lands after paying from the homepage. The return goes
 * through /pricing, which waits for the plan to activate before forwarding to
 * /play; landing on /play directly would let its paywall gate bounce a buyer
 * whose plan is still activating.
 */
const CHECKOUT_RETURN_PATH = checkoutReturnPath("/play");

const VALUE_POINTS: { title: string; description: string }[] = [
  {
    title: "Every legendary position",
    description: "Step into the critical moment of any game in the library, as often as you like.",
  },
  {
    title: "Play friends, bots and tournaments",
    description: "Share a challenge link, face the engine, or enter an event from the same position.",
  },
  {
    title: "Compare against the best line",
    description: "See how your continuation stacks up against the engine after every game.",
  },
];

export function PricingSection() {
  const [billing, setBilling] = useState<PlanKey>("yearly");
  const storeUser = useUserStore((s) => s.user);
  const subscription = useUserStore((s) => s.subscription);
  const { startCheckout, loading, error } = useCheckout();

  // `entitled` is what the server decided; older cached stores predate it and
  // only carry `plan`.
  const isMember = !!storeUser && (subscription?.entitled ?? subscription?.plan === "player");

  function handleSubscribe() {
    void startCheckout(billing, { returnPath: CHECKOUT_RETURN_PATH });
  }

  return (
    <section
      id="pricing"
      aria-labelledby="home-pricing-heading"
      data-testid="home-pricing"
      className="w-full py-12 sm:py-24 px-6 bg-cb-bg relative scroll-mt-16"
    >
      {/* Subtle grid background */}
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="max-w-6xl mx-auto relative">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: EASE }}
          className="text-center mb-10 sm:mb-16"
        >
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="h-px w-16 bg-cb-border-strong" />
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted text-[10px] tracking-[0.3em] uppercase"
            >
              Membership
            </span>
            <div className="h-px w-16 bg-cb-border-strong" />
          </div>

          <h2
            id="home-pricing-heading"
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="text-4xl sm:text-5xl md:text-6xl text-cb-text mb-4"
          >
            One plan. Every legendary game.
          </h2>

          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-cb-text-muted text-lg max-w-xl mx-auto"
          >
            {isMember
              ? `Your ${PLAN_NAME} plan is active. The board is waiting.`
              : `The ${PLAN_NAME} plan unlocks the whole library. Pick monthly or yearly.`}
          </p>
        </motion.div>

        {isMember ? (
          <MemberStrip referenceId={storeUser.referenceId} />
        ) : (
          <>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
              className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] gap-px bg-cb-hover"
            >
              {/* Value points */}
              <div className="bg-cb-bg p-6 sm:p-10 flex flex-col justify-center">
                <ul className="space-y-8">
                  {VALUE_POINTS.map((point) => (
                    <li key={point.title} className="flex gap-4">
                      <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center border border-amber-500/20 bg-amber-500/5">
                        <Check className="w-3 h-3 text-amber-400" />
                      </span>
                      <div>
                        <p
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="text-base font-medium text-cb-text mb-1"
                        >
                          {point.title}
                        </p>
                        <p
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="text-sm text-cb-text-secondary leading-relaxed"
                        >
                          {point.description}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Toggle + card */}
              <div className="bg-cb-bg p-6 sm:p-10">
                <div className="flex justify-center mb-6">
                  <BillingToggle value={billing} onChange={setBilling} />
                </div>
                <PricingCard
                  plan={billing}
                  onSubscribe={handleSubscribe}
                  loading={loading}
                  error={error}
                  isSignedIn={!!storeUser}
                  compact
                />
              </div>
            </motion.div>

            <div className="mt-8 text-center">
              <Link
                href="/pricing"
                data-testid="home-pricing-compare"
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="group inline-flex items-center gap-2 text-sm text-cb-text-secondary hover:text-cb-text transition-colors"
              >
                Compare plans and FAQ
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function MemberStrip({ referenceId }: { referenceId: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
      data-testid="home-pricing-member"
      className="max-w-3xl mx-auto border border-cb-border bg-cb-hover p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5"
    >
      <div className="flex items-center gap-3">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
        </span>
        <p
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="text-sm text-cb-text"
        >
          You&apos;re a {PLAN_NAME} member
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          href="/play"
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="group inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium bg-cb-accent text-cb-accent-fg hover:bg-cb-accent/90 transition-colors"
        >
          Play now
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </Link>
        <Link
          href={`/profile/${referenceId}#membership`}
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="inline-flex items-center justify-center px-5 py-2.5 text-sm text-cb-text-secondary border border-cb-border hover:text-cb-text hover:bg-cb-bg transition-colors"
        >
          Manage membership
        </Link>
      </div>
    </motion.div>
  );
}
