import { createMetadata, safeJsonLd } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = createMetadata({
  title: "Pricing",
  description:
    "Choose your ReplayChess plan — free to play with premium options for serious players and creators.",
  path: "/pricing",
});

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Do you offer refunds?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes, we offer a 30-day money-back guarantee for all new subscriptions. If you're not satisfied with ReplayChess, you can request a full refund within the first 30 days of your subscription. Refunds are subject to a 5% processing fee and usage fees.",
      },
    },
    {
      "@type": "Question",
      name: "What does early access include?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Early access gives you a 30% discount + an extra 20% off (yearly plan only) priority access to new features before they're released to the general public. You'll also be invited to our private Slack channel to help shape the product roadmap.",
      },
    },
    {
      "@type": "Question",
      name: "Can I use my own API keys?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Not at the moment, but we're thinking about it. We're waiting to see if there is significant demand for it. For now, we provide high-performance cloud engines bundled with your subscription.",
      },
    },
    {
      "@type": "Question",
      name: "What payment methods do you accept?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "We accept all major credit cards (Visa, MasterCard, American Express, Discover). For yearly subscriptions for teams or clubs, we also offer wire transfer options.",
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
    { "@type": "Offer", name: "Player", price: "8", priceCurrency: "USD", availability: "https://schema.org/InStock" },
  ],
  aggregateRating: {
    "@type": "AggregateRating",
    ratingValue: "4.8",
    ratingCount: "124",
    bestRating: "5",
    worstRating: "1",
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
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
