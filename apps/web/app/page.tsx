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

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is ReplayChess?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "ReplayChess is a free web application that lets you replay iconic chess positions from history's greatest games. Study grandmaster moves from over 50 chess legends spanning 6 eras, practice 3,600+ openings organized by ECO code, and challenge friends to play from famous positions.",
      },
    },
    {
      "@type": "Question",
      name: "How do I replay a famous chess game on ReplayChess?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Browse the Legends page to find a chess legend like Bobby Fischer or Garry Kasparov. Select a famous position from their profile, then click 'Play from this position' to replay the game against a bot or challenge a friend. You can also browse openings by ECO code and play from any opening position.",
      },
    },
    {
      "@type": "Question",
      name: "Is ReplayChess free to use?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes, ReplayChess is free to play. You can browse all chess legends, study openings, and play games at no cost. Premium features for serious players and creators are available with a subscription starting at $8/month.",
      },
    },
    {
      "@type": "Question",
      name: "What chess openings are available on ReplayChess?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "ReplayChess features over 3,600 chess openings organized by ECO code (A through E), covering Flank Openings, Semi-Open Games, Open Games & French Defense, Closed & Semi-Closed Games, and Indian Defences. Each opening shows the move sequence, resulting position, and lets you play from that position.",
      },
    },
    {
      "@type": "Question",
      name: "Can I play chess with friends on ReplayChess?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes, ReplayChess supports multiplayer play. You can challenge a friend to play from any famous chess position or opening. Simply share a game link and your friend can join to play the position together in real-time.",
      },
    },
  ],
};

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
        dangerouslySetInnerHTML={{ __html: safeJsonLd(faqJsonLd) }}
      />
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
