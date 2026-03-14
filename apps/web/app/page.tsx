import Hero from "./components/Hero";
import { HowToPlay } from "./components/HowToPlay";
import { Navbar } from "./components/Navbar";
import { AgadmatorFeature } from "./components/AgadmatorFeature";
import { Testimonials } from "./components/Testimonials";
import { Footer } from "./components/Footer";
import { safeJsonLd } from "@/lib/seo";

const breadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: "https://www.playchess.tech",
    },
  ],
};

const videoJsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: "King's Gambit Chess Board Animation",
    description:
      "Animated chess board showcasing the King's Gambit opening — a classic aggressive chess strategy.",
    contentUrl:
      "https://www.playchess.tech/Kings_Gambit_Chess_Board_Animation.mp4",
    thumbnailUrl: "https://www.playchess.tech/og-image.jpg",
    uploadDate: "2025-01-01",
  },
  {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: "ReplayChess Feature Preview",
    description:
      "Preview of ReplayChess features — replay legendary chess games and learn from grandmaster moves.",
    contentUrl: "https://www.playchess.tech/video_clip.webm",
    thumbnailUrl: "https://www.playchess.tech/og-image.jpg",
    uploadDate: "2025-01-01",
  },
];

const webAppJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "ReplayChess",
  url: "https://www.playchess.tech",
  description:
    "Replay iconic chess positions from history's greatest games. Study grandmaster moves, challenge friends, and master the classics.",
  applicationCategory: "GameApplication",
  operatingSystem: "Any",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  author: {
    "@type": "Organization",
    name: "ReplayChess",
    url: "https://www.playchess.tech",
  },
  aggregateRating: {
    "@type": "AggregateRating",
    ratingValue: "4.8",
    ratingCount: "124",
    bestRating: "5",
    worstRating: "1",
  },
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbJsonLd) }}
      />
      {videoJsonLd.map((video, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(video) }}
        />
      ))}
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
        {/* <Testimonials /> */}
        <Footer />
      </div>
    </>
  );
}
