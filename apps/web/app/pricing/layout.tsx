import { createMetadata, safeJsonLd } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = createMetadata({
  title: "Chess Training Plans and Pricing",
  description:
    "Compare ReplayChess plans for playing legendary positions, recording games, exporting video, and using chess analysis tools. Start with a free challenge.",
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
        text: "New subscriptions have a 30-day money-back guarantee under the ReplayChess Terms of Service. Contact hello@playchess.tech to request a refund.",
      },
    },
    {
      "@type": "Question",
      name: "What does the Player plan include?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "The Player plan includes unlimited positions, game recording and export, 1080p output, basic AI analysis, and priority access to supported product features.",
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
      name: "Player",
      price: "8",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
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
