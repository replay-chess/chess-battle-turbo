/**
 * Marketing and support copy for the Coaching plan.
 *
 * Pure data with no React or browser dependencies, so it can be imported from
 * server components (JSON-LD in layouts) and client components alike.
 */
import {
  BILLING_PLANS,
  formatPrice,
  monthlyEquivalentCents,
  yearlySavings,
} from "./plans";
import { TRIAL_DAYS } from "./trial-rules";

const SAVINGS = yearlySavings();
const MONTHLY_PRICE = formatPrice(BILLING_PLANS.monthly.priceCents);
const YEARLY_PRICE = formatPrice(BILLING_PLANS.yearly.priceCents);
const YEARLY_PER_MONTH = formatPrice(monthlyEquivalentCents(BILLING_PLANS.yearly));

export const SUPPORT_EMAIL = "hello@playchess.tech";

/** What every Coaching member gets. Shown on the card and the subscriber view. */
export const PLAN_FEATURES: string[] = [
  "Analysis of every Chess.com game you play",
  "Your recurring mistakes, found and ranked",
  "Daily puzzles built from your own mistakes",
  "Your Weakness Profile",
  "Unlimited questions to the coach",
];

export const TRIAL_DAYS_COPY = `${TRIAL_DAYS}-day free trial`;

/** The line under every "Start free trial" button. */
export function trialTermsLine(interval: "month" | "year", chargeDate: Date): string {
  const price = interval === "year" ? `${YEARLY_PRICE}/year` : `${MONTHLY_PRICE}/month`;
  return `Then ${price}. Cancel before ${formatShortDate(chargeDate)} and you won't be charged.`;
}

/** First-charge date for a trial that starts now: day 8. */
export function trialChargeDate(now: Date = new Date()): Date {
  return new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

export const MONEY_BACK_COPY = "30-day money-back guarantee. Cancel anytime.";

export interface FaqItem {
  question: string;
  answer: string;
}

/** Questions a visitor asks before subscribing. */
export const SALES_FAQS: FaqItem[] = [
  {
    question: "How much does ReplayChess cost?",
    answer: `Coaching is ${MONTHLY_PRICE} per month, or ${YEARLY_PRICE} per year. Yearly billing works out to ${YEARLY_PER_MONTH} a month and saves ${SAVINGS.percent}% compared with paying monthly.`,
  },
  {
    question: "Is there a free trial?",
    answer: `Yes. Your first ${TRIAL_DAYS} days are free. You add a card when you start, and nothing is charged until day ${TRIAL_DAYS + 1}. Cancel any time before then and you won't be charged. Each person gets one trial.`,
  },
  {
    question: "Do you offer refunds?",
    answer: `New subscriptions have a 30-day money-back guarantee under the ReplayChess Terms of Service. Contact ${SUPPORT_EMAIL} to request a refund.`,
  },
  {
    question: "What does Coaching include?",
    answer:
      "Coaching analyses your Chess.com games, finds the mistakes you keep repeating, turns them into daily puzzles, builds your Weakness Profile, and lets you ask the coach about any move. Monthly and yearly members get the same features.",
  },
  {
    question: "Is there a free version?",
    answer: `No. ReplayChess is a paid coaching app. The ${TRIAL_DAYS}-day free trial lets you try everything first.`,
  },
  {
    question: "How do I manage or cancel a subscription?",
    answer:
      "Open Membership in your profile. Cancelling during the trial means you are never charged; cancelling later keeps your access until the end of the period you paid for.",
  },
];

/** Questions an existing member asks about their subscription. */
export const SUBSCRIBER_FAQS: FaqItem[] = [
  {
    question: "How do I cancel my subscription?",
    answer:
      "You can cancel anytime from the Manage Billing page. Your access continues until the end of your current billing period. No questions asked.",
  },
  {
    question: "When am I billed?",
    answer:
      "Monthly members are billed on the same date each month as their original subscription date. Yearly members are billed once a year on their anniversary date. Your next billing date is shown above.",
  },
  {
    question: "Can I switch between monthly and yearly billing?",
    answer: `Yes. Open the Membership section of your profile to change plans. Switching to yearly saves ${SAVINGS.percent}% and the unused part of your current period is credited.`,
  },
  {
    question: "Can I get a refund?",
    answer: `New subscriptions have a 30-day money-back guarantee under the ReplayChess Terms of Service. Contact ${SUPPORT_EMAIL} to request a refund.`,
  },
  {
    question: "What happens when my trial ends?",
    answer: `On day ${TRIAL_DAYS + 1} your card is charged for the plan you picked and your membership continues. We email you two days before. Cancel before then and you won't be charged.`,
  },
  {
    question: "How do I update my payment method?",
    answer:
      'Click "Manage Billing" above to access the customer portal. From there you can update your credit card, view invoices, and manage all billing details.',
  },
];

/** Formats an ISO timestamp as "Sep 10, 2026". Returns "—" for bad input. */
export function formatBillingDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Formats a date as "8 Nov". */
export function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export interface TrialCopyInput {
  trial?: { active: boolean; endsAt: string | null; daysLeft: number } | null;
  cancelAtPeriodEnd?: boolean;
  interval?: "month" | "year" | null;
  priceCents?: number | null;
}

export interface TrialCopy {
  /** Short status chip, e.g. "Trial · 5 days left". */
  badge: string;
  /** Label for the date tile. */
  dateLabel: string;
  /** The trial end / first charge date, e.g. "8 Nov". */
  dateValue: string;
  /** One sentence for banners and the membership card. */
  note: string;
}

/**
 * Copy for a member who is inside their free trial, or null when they are
 * not. Cancelling during the trial means they are never charged.
 */
export function trialMembershipCopy(input: TrialCopyInput): TrialCopy | null {
  const trial = input.trial;
  if (!trial?.active || !trial.endsAt) return null;
  const end = new Date(trial.endsAt);
  if (Number.isNaN(end.getTime())) return null;
  const date = formatShortDate(end);
  if (input.cancelAtPeriodEnd) {
    return {
      badge: `Trial · ends ${date}`,
      dateLabel: "Trial ends",
      dateValue: date,
      note: `Your trial ends on ${date}. You won't be charged.`,
    };
  }
  const days = trial.daysLeft;
  const price =
    input.priceCents != null
      ? `${formatPrice(input.priceCents)}${input.interval === "year" ? "/year" : "/month"}`
      : input.interval === "year"
        ? `${YEARLY_PRICE}/year`
        : `${MONTHLY_PRICE}/month`;
  return {
    badge: `Trial · ${days} day${days === 1 ? "" : "s"} left`,
    dateLabel: "First charge",
    dateValue: date,
    note: `Your ${TRIAL_DAYS}-day free trial is on. First charge ${price} on ${date}. Cancel before then and you won't be charged.`,
  };
}
