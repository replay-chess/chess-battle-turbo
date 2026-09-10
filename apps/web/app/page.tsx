import Hero from "./components/Hero";
import { HowToPlay } from "./components/HowToPlay";
import { Navbar } from "./components/Navbar";
import { AgadmatorFeature } from "./components/AgadmatorFeature";
import { Footer } from "./components/Footer";
import { PricingSection } from "./components/PricingSection";
import { BASE_URL, safeJsonLd } from "@/lib/seo";
import { BILLING_PLANS, PLAN_KEYS, PLAN_NAME } from "@/lib/billing/plans";

// Mirrors the offers published on /pricing so the two never drift.
const planOffers = PLAN_KEYS.map((key) => ({
  "@type": "Offer",
  name: `${PLAN_NAME} ${BILLING_PLANS[key].label}`,
  price: (BILLING_PLANS[key].priceCents / 100).toFixed(2),
  priceCurrency: "USD",
  availability: "https://schema.org/InStock",
  url: `${BASE_URL}/pricing`,
}));

const webAppJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "@id": `${BASE_URL}/#application`,
  name: "ReplayChess",
  url: BASE_URL,
  description:
    "Replay iconic chess positions from history's greatest games, test your calculation, and learn the plans behind memorable moves.",
  applicationCategory: "GameApplication",
  operatingSystem: "Any",
  offers: planOffers,
  publisher: {
    "@id": `${BASE_URL}/#organization`,
  },
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(webAppJsonLd) }}
      />
      <Navbar />
      <div className="w-full bg-cb-bg text-cb-text">
        <div className="h-screen w-full">
          <Hero />
        </div>
        <HowToPlay />
        <AgadmatorFeature />
        <PricingSection />
        <Footer />
      </div>
    </>
  );
}
