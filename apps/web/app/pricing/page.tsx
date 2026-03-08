"use client"

import React, { Suspense, useState, useEffect } from 'react'
import { Footer } from '../components/Footer'
import { Navbar } from '../components/Navbar'
import { Bot, ChevronDown, Video, Loader2, Check, CreditCard, LifeBuoy, ArrowRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useSearchParams } from 'next/navigation'
import { useUserStore } from '@/lib/stores'

const PLAYER_PRODUCT_ID = process.env.NEXT_PUBLIC_DODO_PLAYER_PRODUCT_ID!

const EASE = [0.22, 1, 0.36, 1] as const

const PLAN_FEATURES = [
  'Unlimited Positions',
  'Record & Export',
  '1080p Quality',
  'Basic AI Analysis',
  'Priority Features',
]

const SUBSCRIBER_FAQS = [
  {
    question: 'How do I cancel my subscription?',
    answer: 'You can cancel anytime from the Manage Billing page. Your access continues until the end of your current billing period. No questions asked.',
  },
  {
    question: 'When am I billed each month?',
    answer: 'You are billed on the same date each month as your original subscription date. If you subscribed on the 15th, you will be billed on the 15th of each subsequent month.',
  },
  {
    question: 'Can I get a refund?',
    answer: 'Yes, we offer a 30-day money-back guarantee. If you are not satisfied, contact us at hello@playchess.tech within 30 days of subscribing for a full refund, subject to a 5% processing fee.',
  },
  {
    question: 'How do I update my payment method?',
    answer: 'Click "Manage Billing" above to access the customer portal. From there you can update your credit card, view invoices, and manage all billing details.',
  },
]

function formatBillingDate(isoDate: string): string {
  const date = new Date(isoDate)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const SALES_FAQS = [
  {
    question: "Do you offer refunds?",
    answer: "Yes, we offer a 30-day money-back guarantee for all new subscriptions. If you're not satisfied with ReplayChess, you can request a full refund within the first 30 days of your subscription. Refunds are subject to a 5% processing fee and usage fees."
  },
  {
    question: "What does early access include?",
    answer: "Early access gives you a 30% discount + an extra 20% off (yearly plan only) priority access to new features before they're released to the general public. You'll also be invited to our private Slack channel to help shape the product roadmap."
  },
  {
    question: "Can I use my own API keys?",
    answer: "Not at the moment, but we're thinking about it. We're waiting to see if there is significant demand for it. For now, we provide high-performance cloud engines bundled with your subscription."
  },
  {
    question: "What payment methods do you accept?",
    answer: "We accept all major credit cards (Visa, MasterCard, American Express, Discover). For yearly subscriptions for teams or clubs, we also offer wire transfer options."
  }
]

type SubscriptionInfo = {
  plan: string | null
  customerId?: string
  subscription?: {
    id: string
    status: string
    productId: string
    nextBillingDate: string
  }
}

export default function PricingPage() {
  return (
    <Suspense>
      <PricingContent />
    </Suspense>
  )
}

function PricingContent() {
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const searchParams = useSearchParams()
  const checkoutSuccess = searchParams.get('checkout') === 'success'

  // Read user + subscription from Zustand store
  const storeUser = useUserStore((s) => s.user)
  const subscription = useUserStore((s) => s.subscription)
  const isHydrated = useUserStore((s) => s.isHydrated)

  const subInfo: SubscriptionInfo | null = subscription
    ? {
        plan: subscription.plan,
        customerId: subscription.customerId,
        subscription: subscription.subscription,
      }
    : null

  async function handleCheckout() {
    if (!storeUser) {
      window.location.href = '/sign-in'
      return
    }
    setCheckoutLoading(true)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: PLAYER_PRODUCT_ID,
          email: storeUser.email,
          name: storeUser.name,
          metadata: { clerkUserId: storeUser.clerkUserId },
        }),
      })
      if (!res.ok) throw new Error(res.statusText)
      const data = await res.json()
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
      }
    } catch {
      // checkout failed — button re-enables via finally
    } finally {
      setCheckoutLoading(false)
    }
  }

  const isSubscribed = subInfo?.plan === 'player'

  if (!isHydrated) {
    return (
      <div className="min-h-screen bg-black text-white">
        <Navbar />
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
        </div>
        <Footer />
      </div>
    )
  }

  if (isSubscribed) {
    return (
      <div className="min-h-screen bg-black text-white">
        <Navbar />

        {/* Subscriber Hero */}
        <section className="relative pt-32 pb-20 overflow-hidden">
          <div
            className="absolute inset-0 opacity-[0.015]"
            style={{
              backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
              backgroundSize: '80px 80px',
            }}
          />
          <div className="relative z-10 max-w-3xl mx-auto px-4 text-center">
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, ease: EASE }}
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-[10px] tracking-[0.3em] uppercase text-white/40 mb-6"
            >
              Membership
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: EASE }}
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-5xl sm:text-6xl md:text-7xl mb-4 text-white"
            >
              {storeUser?.name ? `Welcome back, ${storeUser.name.split(' ')[0]}` : 'Your Membership'}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-lg text-white/40"
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
              className="border border-white/10 bg-white/[0.02] mb-12"
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
                  className="text-4xl sm:text-5xl text-white mb-2"
                >
                  Player
                </h2>
                <p
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-2xl text-white/60"
                >
                  $8<span className="text-base text-white/30">/mo</span>
                </p>
              </div>

              {/* Status strip */}
              <div className="grid grid-cols-2 gap-px bg-white/[0.04]">
                <div className="bg-black p-5">
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2"
                  >
                    Next Billing Date
                  </p>
                  <p
                    style={{ fontFamily: "'Geist Mono', monospace" }}
                    className="text-sm text-white/80"
                  >
                    {subInfo?.subscription?.nextBillingDate
                      ? formatBillingDate(subInfo.subscription.nextBillingDate)
                      : '—'}
                  </p>
                </div>
                <div className="bg-black p-5">
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2"
                  >
                    Status
                  </p>
                  <p
                    style={{ fontFamily: "'Geist Mono', monospace" }}
                    className="text-sm text-amber-400"
                  >
                    {subInfo?.subscription?.status
                      ? subInfo.subscription.status.charAt(0).toUpperCase() + subInfo.subscription.status.slice(1)
                      : 'Active'}
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
                <div className="flex-1 h-px bg-gradient-to-r from-transparent to-white/10" />
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[10px] tracking-[0.3em] uppercase text-white/40"
                >
                  Your Access
                </p>
                <div className="flex-1 h-px bg-gradient-to-l from-transparent to-white/10" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-white/[0.04]">
                {PLAN_FEATURES.map((feature, index) => (
                  <motion.div
                    key={feature}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.4 + index * 0.06, ease: EASE }}
                    className="bg-black p-5"
                  >
                    <div className="flex items-center justify-center w-8 h-8 border border-amber-500/20 bg-amber-500/5 mb-3">
                      <Check className="w-3.5 h-3.5 text-amber-400" />
                    </div>
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-sm text-white/80 mb-0.5"
                    >
                      {feature}
                    </p>
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-[11px] text-white/30"
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
                  className="group border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-colors p-6 flex flex-col"
                >
                  <div className="flex items-center justify-between mb-3">
                    <CreditCard className="w-5 h-5 text-white/40" />
                    <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-white/40 transition-colors" />
                  </div>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm font-medium text-white mb-1"
                  >
                    Manage Billing
                  </p>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-xs text-white/30"
                  >
                    Update payment, view invoices, cancel
                  </p>
                </a>
                <a
                  href="mailto:hello@playchess.tech"
                  className="group border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-colors p-6 flex flex-col"
                >
                  <div className="flex items-center justify-between mb-3">
                    <LifeBuoy className="w-5 h-5 text-white/40" />
                    <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-white/40 transition-colors" />
                  </div>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm font-medium text-white mb-1"
                  >
                    Get Support
                  </p>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-xs text-white/30"
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
                className="text-3xl sm:text-4xl mb-8 text-center text-white"
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
                    className="border border-white/10 overflow-hidden"
                  >
                    <button
                      onClick={() => setOpenFaq(openFaq === index ? null : index)}
                      className="w-full p-5 text-left flex justify-between items-center bg-white/[0.02] hover:bg-white/5 transition-colors"
                    >
                      <span
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-sm font-medium text-white"
                      >
                        {faq.question}
                      </span>
                      <ChevronDown className={`w-4 h-4 text-white/40 transition-transform duration-300 ${openFaq === index ? 'rotate-180' : ''}`} />
                    </button>
                    <AnimatePresence>
                      {openFaq === index && (
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: 'auto' }}
                          exit={{ height: 0 }}
                          className="overflow-hidden"
                        >
                          <div
                            style={{ fontFamily: "'Geist', sans-serif" }}
                            className="p-5 border-t border-white/5 text-sm text-white/40 leading-relaxed"
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
    )
  }

  // Non-subscriber sales page (unchanged)
  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />

      {/* Hero Section with Video Background */}
      <section className="relative h-[60vh] min-h-[500px] w-full overflow-hidden">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 min-w-full min-h-full w-auto h-auto opacity-20 object-cover grayscale"
        >
          <source
            src="/Kings_Gambit_Chess_Board_Animation.mp4"
            type="video/mp4"
          />
        </video>

        {/* Gradient overlays */}
        <div className="absolute inset-0 bg-gradient-to-b from-black via-transparent to-black" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-black/50" />

        {/* Subtle grid background */}
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
            backgroundSize: '80px 80px',
          }}
        />

        <div className="relative z-10 h-full flex flex-col items-center justify-center text-center px-4">
          <motion.h1
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="text-6xl sm:text-7xl md:text-8xl lg:text-9xl mb-6 text-white"
          >
            Pricing
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-lg sm:text-xl md:text-2xl text-white/40 max-w-2xl"
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
                className="text-md text-white/40 mb-8 mx-auto"
              >
                Game Recorder, Position Editor, AI Assistant, Voice Coach, Analysis Generator - all in one powerful package.
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
              <div className="border border-white/10 bg-white/[0.02] p-8">
                <div className="flex items-center justify-between mb-4">
                  <h3
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm font-medium text-white/60 uppercase tracking-widest"
                  >
                    Player
                  </h3>
                </div>
                <p
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-5xl text-white mb-2"
                >
                  $8<span className="text-lg text-white/40">/mo</span>
                </p>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-sm text-white/30 mb-8"
                >
                  For casual players and learners
                </p>
                <ul className="space-y-3 text-sm text-white/40 mb-8" style={{ fontFamily: "'Geist', sans-serif" }}>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-white/30" />
                    Unlimited positions
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-white/30" />
                    Record &amp; export
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-white/30" />
                    1080p quality
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-white/30" />
                    Basic AI analysis
                  </li>
                </ul>

                {/* Subscribe button */}
                <button
                  onClick={handleCheckout}
                  disabled={checkoutLoading}
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="w-full py-3 text-sm font-medium text-black bg-white hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {checkoutLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : !storeUser ? (
                    'Sign in to subscribe'
                  ) : (
                    'Subscribe'
                  )}
                </button>
              </div>
            </motion.div>

            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-sm text-white/30 text-center mt-8 mb-8 max-w-xl mx-auto p-4"
            >
              Join our community of chess creators and masters. Get priority access to new features and shape the future of chess training.
            </p>
          </section>
        </main>

        {/* Creator Logos */}
        <div className="mt-20">
          <div className="w-full max-w-3xl mx-auto">
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-center text-white/30 mb-4 text-xs uppercase tracking-widest"
            >
              Supported by grandmasters at
            </p>
            <div className="relative overflow-hidden" style={{ maskImage: 'linear-gradient(to right, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0) 6%, rgb(0, 0, 0) 12%, rgb(0, 0, 0) 88%, rgba(0, 0, 0, 0) 94%, rgba(0, 0, 0, 0) 100%)' }}>
              <div className="flex animate-scroll whitespace-nowrap py-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="flex-shrink-0 mx-8">
                    <div className="h-8 w-24 bg-white/5 border border-white/10" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Features Table */}
        <section className="py-20">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-3xl sm:text-4xl lg:text-5xl mb-12 text-center text-white"
            >
              What&apos;s Included
            </h2>
            <div className="overflow-x-auto border border-white/10">
              <table className="w-full overflow-hidden text-sm">
                <thead>
                  <tr>
                    <th className="p-4 text-left bg-white/5"></th>
                    <th className="p-4 text-center bg-white/5">
                      <h3
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-sm font-medium text-white mb-2"
                      >
                        Player
                      </h3>
                      <p
                        style={{ fontFamily: "'Instrument Serif', serif" }}
                        className="text-xl text-white/60"
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
                      className="p-4 text-xs uppercase tracking-widest font-medium text-white/60 bg-white/5 flex items-center gap-2"
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
                    <tr key={row.label} className="border-t border-white/10">
                      <td
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="p-4 text-white/40 bg-white/[0.02]"
                      >
                        {row.label}
                      </td>
                      <td
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="p-4 text-center text-white/40 bg-white/5"
                      >
                        {row.value}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td
                      colSpan={2}
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="p-4 text-xs uppercase tracking-widest font-medium text-white/60 bg-white/5 flex items-center gap-2"
                    >
                      AI Features <Bot className="w-3 h-3" />
                    </td>
                  </tr>
                  {[
                    { label: "AI Analysis", value: "Basic" },
                  ].map((row) => (
                    <tr key={row.label} className="border-t border-white/10">
                      <td
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="p-4 text-white/40 bg-white/[0.02]"
                      >
                        {row.label}
                      </td>
                      <td
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="p-4 text-center text-white/40 bg-white/5"
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
              className="text-3xl sm:text-4xl lg:text-5xl mb-12 text-center text-white"
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
                  className="border border-white/10 overflow-hidden"
                >
                  <button
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    className="w-full p-5 text-left flex justify-between items-center bg-white/[0.02] hover:bg-white/5 transition-colors"
                  >
                    <span
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-sm font-medium text-white"
                    >
                      {faq.question}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-white/40 transition-transform duration-300 ${openFaq === index ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {openFaq === index && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="overflow-hidden"
                      >
                        <div
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="p-5 border-t border-white/5 text-sm text-white/40 leading-relaxed"
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
  )
}
