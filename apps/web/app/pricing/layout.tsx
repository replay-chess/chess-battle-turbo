import { createMetadata, safeJsonLd } from "@/lib/seo";
import { BILLING_PLANS, formatPrice } from "@/lib/billing/plans";
import { SALES_FAQS } from "@/lib/billing/copy";
import type { Metadata } from "next";

const MONTHLY_PRICE = formatPrice(BILLING_PLANS.monthly.priceCents);
const YEARLY_PRICE = formatPrice(BILLING_PLANS.yearly.priceCents);

export const metadata: Metadata = createMetadata({
  title: "Chess Training Plans and Pricing",
  description: `ReplayChess Player plan from ${MONTHLY_PRICE}/month or ${YEARLY_PRICE}/year. Play legendary positions, record games, and use chess analysis tools. Start with a free challenge.`,
  path: "/pricing",
});

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: SALES_FAQS.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  })),
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
