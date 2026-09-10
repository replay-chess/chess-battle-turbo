import { createMetadata, safeJsonLd } from "@/lib/seo";
import {
  BILLING_PLANS,
  formatPrice,
  monthlyEquivalentCents,
  yearlySavings,
} from "@/lib/billing/plans";
import type { Metadata } from "next";

const MONTHLY_PRICE = formatPrice(BILLING_PLANS.monthly.priceCents);
const YEARLY_PRICE = formatPrice(BILLING_PLANS.yearly.priceCents);
const YEARLY_PER_MONTH = formatPrice(monthlyEquivalentCents(BILLING_PLANS.yearly));
const SAVINGS = yearlySavings();

export const metadata: Metadata = createMetadata({
  title: "Chess Training Plans and Pricing",
  description: `ReplayChess Player plan from ${MONTHLY_PRICE}/month or ${YEARLY_PRICE}/year. Play legendary positions, record games, and use chess analysis tools. Start with a free challenge.`,
  path: "/pricing",
});

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "How much does ReplayChess cost?",
      acceptedAnswer: {
        "@type": "Answer",
        text: `The Player plan is ${MONTHLY_PRICE} per month, or ${YEARLY_PRICE} per year. Yearly billing works out to ${YEARLY_PER_MONTH} a month and saves ${SAVINGS.percent}% compared with paying monthly.`,
      },
    },
    {
      "@type": "Question",
      name: "Do you offer refunds?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "New subscriptions have a 30-day money-back guarantee under the ReplayChess Terms of Service. Contact hello@playchess.tech to request a refund.",
      },
    },
    {
      "@type": "Question",
      name: "What does the Player plan include?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "The Player plan includes unlimited positions, game recording and export, 1080p output, basic AI analysis, and priority access to supported product features. Monthly and yearly members get the same features.",
      },
    },
    {
      "@type": "Question",
      name: "Can I try ReplayChess before subscribing?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. The public position challenges are free and do not require an account. Open the Try page to play a featured position against the engine.",
      },
    },
    {
      "@type": "Question",
      name: "How do I manage or cancel a subscription?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Signed-in subscribers can open the account menu and choose Manage Billing. Cancellation takes effect according to the billing terms shown in the customer portal.",
      },
    },
  ],
};

const softwareAppJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "ReplayChess",
  applicationCategory: "GameApplication",
  operatingSystem: "Web",
  offers: [
    {
      "@type": "Offer",
      name: "Player Monthly",
      price: (BILLING_PLANS.monthly.priceCents / 100).toFixed(2),
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: "https://www.playchess.tech/pricing",
    },
    {
      "@type": "Offer",
      name: "Player Yearly",
      price: (BILLING_PLANS.yearly.priceCents / 100).toFixed(2),
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: "https://www.playchess.tech/pricing",
    },
  ],
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(softwareAppJsonLd) }}
      />
      {children}
    </>
  );
}
