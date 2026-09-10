/**
 * Marketing and support copy for the Player plan.
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

const SAVINGS = yearlySavings();
const MONTHLY_PRICE = formatPrice(BILLING_PLANS.monthly.priceCents);
const YEARLY_PRICE = formatPrice(BILLING_PLANS.yearly.priceCents);
const YEARLY_PER_MONTH = formatPrice(monthlyEquivalentCents(BILLING_PLANS.yearly));

export const SUPPORT_EMAIL = "hello@playchess.tech";

/** What every Player member gets. Shown on the card and the subscriber view. */
export const PLAN_FEATURES: string[] = [
  "Unlimited positions",
  "Record & export",
  "1080p quality",
  "Basic AI analysis",
  "Priority features",
];

export const MONEY_BACK_COPY = "30-day money-back guarantee. Cancel anytime.";

export interface FaqItem {
  question: string;
  answer: string;
}

/** Questions a visitor asks before subscribing. */
export const SALES_FAQS: FaqItem[] = [
  {
    question: "How much does ReplayChess cost?",
    answer: `The Player plan is ${MONTHLY_PRICE} per month, or ${YEARLY_PRICE} per year. Yearly billing works out to ${YEARLY_PER_MONTH} a month and saves ${SAVINGS.percent}% compared with paying monthly.`,
  },
  {
    question: "Do you offer refunds?",
    answer: `New subscriptions have a 30-day money-back guarantee under the ReplayChess Terms of Service. Contact ${SUPPORT_EMAIL} to request a refund.`,
  },
  {
    question: "What does the Player plan include?",
    answer:
      "The Player plan includes unlimited positions, game recording and export, 1080p output, basic AI analysis, and priority access to supported product features. Monthly and yearly members get the same features.",
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
