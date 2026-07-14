"use client";

import React, { Suspense, useState } from "react";
import { Footer } from "../components/Footer";
import { Navbar } from "../components/Navbar";
import {
  Bot,
  ChevronDown,
  Video,
  Loader2,
  Check,
  CreditCard,
  LifeBuoy,
  ArrowRight,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useSearchParams } from "next/navigation";
import { useUserStore } from "@/lib/stores";
import Image from "next/image";

const PLAYER_PRODUCT_ID = process.env.NEXT_PUBLIC_DODO_PLAYER_PRODUCT_ID!;

const EASE = [0.22, 1, 0.36, 1] as const;

const PLAN_FEATURES = [
  "Unlimited Positions",
  "Record & Export",
  "1080p Quality",
  "Basic AI Analysis",
  "Priority Features",
];

const SUBSCRIBER_FAQS = [
  {
    question: "How do I cancel my subscription?",
    answer:
      "You can cancel anytime from the Manage Billing page. Your access continues until the end of your current billing period. No questions asked.",
  },
  {
    question: "When am I billed each month?",
    answer:
      "You are billed on the same date each month as your original subscription date. If you subscribed on the 15th, you will be billed on the 15th of each subsequent month.",
  },
  {
    question: "Can I get a refund?",
    answer:
      "New subscriptions have a 30-day money-back guarantee under the ReplayChess Terms of Service. Contact hello@playchess.tech to request a refund.",
  },
  {
    question: "How do I update my payment method?",
    answer:
      'Click "Manage Billing" above to access the customer portal. From there you can update your credit card, view invoices, and manage all billing details.',
  },
];

function formatBillingDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const SALES_FAQS = [
  {
    question: "Do you offer refunds?",
    answer:
      "New subscriptions have a 30-day money-back guarantee under the ReplayChess Terms of Service. Contact hello@playchess.tech to request a refund.",
  },
  {
    question: "What does the Player plan include?",
    answer:
      "The Player plan includes unlimited positions, game recording and export, 1080p output, basic AI analysis, and priority access to supported product features.",
  },
  {
    question: "Can I try ReplayChess before subscribing?",
    answer:
      "Yes. The public position challenges are free and do not require an account. Open the Try page to play a featured position against the engine.",
  },
  {
    question: "How do I manage or cancel a subscription?",
    answer:
      "Signed-in subscribers can open the account menu and choose Manage Billing. Cancellation takes effect according to the billing terms shown in the customer portal.",
  },
];

type SubscriptionInfo = {
  plan: string | null;
  customerId?: string;
  subscription?: {
    id: string;
    status: string;
    productId: string;
    nextBillingDate: string;
  };
};

export default function PricingPage() {
  return (
    <Suspense>
      <PricingContent />
    </Suspense>
  );
}

function PricingContent() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const searchParams = useSearchParams();
  const checkoutSuccess = searchParams.get("checkout") === "success";

  // Read user + subscription from Zustand store
  const storeUser = useUserStore((s) => s.user);
  const subscription = useUserStore((s) => s.subscription);
  const subInfo: SubscriptionInfo | null = subscription
    ? {
        plan: subscription.plan,
        customerId: subscription.customerId,
        subscription: subscription.subscription,
      }
    : null;

  async function handleCheckout() {
    if (!storeUser) {
      window.location.href = "/sign-in";
      return;
    }
    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: PLAYER_PRODUCT_ID,
          email: storeUser.email,
          name: storeUser.name,
          metadata: { clerkUserId: storeUser.clerkUserId },
        }),
      });
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch {
      // checkout failed — button re-enables via finally
    } finally {
      setCheckoutLoading(false);
    }
  }

  const isSubscribed = subInfo?.plan === "player";

  if (isSubscribed) {
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
              Manage your Player plan and billing details.
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
                <div className="border border-amber-500/30 bg-amber-500/10 p-4 text-center">
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm text-amber-400"
                  >
                    Payment successful! Your subscription is now active.
                  </p>
                </div>
              </motion.div>
            )}

            {/* Membership Status Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2, ease: EASE }}
              className="border border-cb-border bg-cb-hover mb-12"
            >
              <div className="p-8">
                <div className="flex items-center gap-3 mb-6">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
                  </span>
                  <span
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-xs font-medium text-amber-400 uppercase tracking-widest"
                  >
                    Active
                  </span>
                </div>
                <h2
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-4xl sm:text-5xl text-cb-text mb-2"
                >
                  Player
                </h2>
                <p
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-2xl text-cb-text-secondary"
                >
                  $8<span className="text-base text-cb-text-muted">/mo</span>
                </p>
              </div>

              {/* Status strip */}
              <div className="grid grid-cols-2 gap-px bg-cb-hover">
                <div className="bg-cb-bg p-5">
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
                  >
                    Next Billing Date
                  </p>
                  <p
                    style={{ fontFamily: "'Geist Mono', monospace" }}
                    className="text-sm text-cb-text-secondary"
                  >
                    {subInfo?.subscription?.nextBillingDate
                      ? formatBillingDate(subInfo.subscription.nextBillingDate)
                      : "—"}
                  </p>
                </div>
                <div className="bg-cb-bg p-5">
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
                  >
                    Status
                  </p>
                  <p
                    style={{ fontFamily: "'Geist Mono', monospace" }}
                    className="text-sm text-amber-400"
                  >
                    {subInfo?.subscription?.status
                      ? subInfo.subscription.status.charAt(0).toUpperCase() +
                        subInfo.subscription.status.slice(1)
                      : "Active"}
                  </p>
                </div>
              </div>
            </motion.div>

            {/* Feature Access Grid */}
            <motion.section
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.35, ease: EASE }}
              className="mb-12"
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

            {/* Quick Actions */}
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5, ease: EASE }}
              className="mb-20"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <a
                  href={`/api/customer-portal?customer_id=${subInfo?.customerId}`}
                  className="group border border-cb-border bg-cb-hover hover:bg-cb-hover transition-colors p-6 flex flex-col"
                >
                  <div className="flex items-center justify-between mb-3">
                    <CreditCard className="w-5 h-5 text-cb-text-muted" />
                    <ArrowRight className="w-4 h-4 text-cb-text-faint group-hover:text-cb-text-muted transition-colors" />
                  </div>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm font-medium text-cb-text mb-1"
                  >
                    Manage Billing
                  </p>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-xs text-cb-text-muted"
                  >
                    Update payment, view invoices, cancel
                  </p>
                </a>
                <a
                  href="mailto:hello@playchess.tech"
                  className="group border border-cb-border bg-cb-hover hover:bg-cb-hover transition-colors p-6 flex flex-col"
                >
                  <div className="flex items-center justify-between mb-3">
                    <LifeBuoy className="w-5 h-5 text-cb-text-muted" />
                    <ArrowRight className="w-4 h-4 text-cb-text-faint group-hover:text-cb-text-muted transition-colors" />
                  </div>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm font-medium text-cb-text mb-1"
                  >
                    Get Support
                  </p>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-xs text-cb-text-muted"
                  >
                    Help with subscription or features
                  </p>
                </a>
              </div>
            </motion.section>

            {/* Subscriber FAQ */}
            <section className="mb-20">
              <h2
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-3xl sm:text-4xl mb-8 text-center text-cb-text"
              >
                Subscription FAQ
              </h2>
              <div className="space-y-3">
                {SUBSCRIBER_FAQS.map((faq, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 }}
                    className="border border-cb-border overflow-hidden"
                  >
                    <button
                      onClick={() =>
                        setOpenFaq(openFaq === index ? null : index)
                      }
                      className="w-full p-5 text-left flex justify-between items-center bg-cb-hover hover:bg-cb-hover transition-colors"
                    >
                      <span
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-sm font-medium text-cb-text"
                      >
                        {faq.question}
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 text-cb-text-muted transition-transform duration-300 ${openFaq === index ? "rotate-180" : ""}`}
                      />
                    </button>
                    <AnimatePresence>
                      {openFaq === index && (
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: "auto" }}
                          exit={{ height: 0 }}
                          className="overflow-hidden"
                        >
                          <div
                            style={{ fontFamily: "'Geist', sans-serif" }}
                            className="p-5 border-t border-cb-border text-sm text-cb-text-muted leading-relaxed"
                          >
                            {faq.answer}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))}
              </div>
            </section>
          </main>

          <Footer />
        </div>
      </div>
    );
  }

  // Non-subscriber sales page (unchanged)
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

            {/* Checkout success banner */}
            {checkoutSuccess && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-md mx-auto mb-8 px-4"
              >
                <div className="border border-amber-500/30 bg-amber-500/10 p-4 text-center">
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm text-amber-400"
                  >
                    Payment successful! Your subscription is being activated.
                  </p>
                </div>
              </motion.div>
            )}

            {/* Single Player Pricing Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="max-w-md mx-auto px-4 sm:px-6"
            >
              <div className="border border-cb-border bg-cb-hover p-8">
                <div className="flex items-center justify-between mb-4">
                  <h3
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm font-medium text-cb-text-secondary uppercase tracking-widest"
                  >
                    Player
                  </h3>
                </div>
                <p
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-5xl text-cb-text mb-2"
                >
                  $8<span className="text-lg text-cb-text-muted">/mo</span>
                </p>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-sm text-cb-text-muted mb-8"
                >
                  For casual players and learners
                </p>
                <ul
                  className="space-y-3 text-sm text-cb-text-muted mb-8"
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-cb-text-muted" />
                    Unlimited positions
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-cb-text-muted" />
                    Record &amp; export
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-cb-text-muted" />
                    1080p quality
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-cb-text-muted" />
                    Basic AI analysis
                  </li>
                </ul>

                {/* Subscribe button */}
                <button
                  onClick={handleCheckout}
                  disabled={checkoutLoading}
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="w-full py-3 text-sm font-medium text-cb-accent-fg bg-cb-accent hover:bg-cb-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {checkoutLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : !storeUser ? (
                    "Sign in to subscribe"
                  ) : (
                    "Subscribe"
                  )}
                </button>
              </div>
            </motion.div>

            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-sm text-cb-text-muted text-center mt-8 mb-8 max-w-xl mx-auto p-4"
            >
              Review the included features and billing FAQs before subscribing.
              Questions can be sent to hello@playchess.tech.
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
                        Player
                      </h3>
                      <p
                        style={{ fontFamily: "'Instrument Serif', serif" }}
                        className="text-xl text-cb-text-secondary"
                      >
                        $8/mo
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
            <h2
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-3xl sm:text-4xl lg:text-5xl mb-12 text-center text-cb-text"
            >
              Frequently Asked Questions
            </h2>
            <div className="space-y-3">
              {SALES_FAQS.map((faq, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="border border-cb-border overflow-hidden"
                >
                  <button
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    className="w-full p-5 text-left flex justify-between items-center bg-cb-hover hover:bg-cb-hover transition-colors"
                  >
                    <span
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-sm font-medium text-cb-text"
                    >
                      {faq.question}
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 text-cb-text-muted transition-transform duration-300 ${openFaq === index ? "rotate-180" : ""}`}
                    />
                  </button>
                  <AnimatePresence>
                    {openFaq === index && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: "auto" }}
                        exit={{ height: 0 }}
                        className="overflow-hidden"
                      >
                        <div
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="p-5 border-t border-cb-border text-sm text-cb-text-muted leading-relaxed"
                        >
                          {faq.answer}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <Footer />
      </div>
    </div>
  );
}
