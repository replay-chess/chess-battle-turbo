import Hero from "./components/Hero";
import { HowToPlay } from "./components/HowToPlay";
import { Navbar } from "./components/Navbar";
import { AgadmatorFeature } from "./components/AgadmatorFeature";
import { Footer } from "./components/Footer";
import { BASE_URL, safeJsonLd } from "@/lib/seo";

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
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
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
        <Footer />
      </div>
    </>
  );
}
