import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { safeJsonLd } from "@/lib/seo";
import { Navbar } from "../../components/Navbar";
import { Footer } from "../../components/Footer";

import { OpeningBoardPreview } from "./OpeningBoardPreview";

const ecoCategories: Record<string, { name: string; description: string }> = {
  A: { name: "Flank Openings", description: "characterized by moves like 1.c4, 1.Nf3, or 1.f4, aiming to control the center indirectly" },
  B: { name: "Semi-Open Games", description: "where Black responds to 1.e4 with something other than 1...e5, including the Sicilian Defense, Caro-Kann, and Pirc" },
  C: { name: "Open Games & French Defense", description: "beginning with 1.e4 e5 or 1.e4 e6, including the Italian Game, Ruy Lopez, and French Defense" },
  D: { name: "Closed & Semi-Closed Games", description: "arising from 1.d4 d5, including the Queen's Gambit, Slav Defense, and related systems" },
  E: { name: "Indian Defences", description: "where Black responds to 1.d4 with 1...Nf6, including the Nimzo-Indian, Queen's Indian, and King's Indian" },
};

interface Props {
  params: Promise<{ referenceId: string }>;
}

export default async function OpeningDetailPage({ params }: Props) {
  const { referenceId } = await params;

  const opening = await prisma.opening.findUnique({
    where: { referenceId },
  });

  if (!opening || !opening.isActive) {
    notFound();
  }

  const ecoLetter = opening.eco.charAt(0);
  const ecoCategory = ecoCategories[ecoLetter];
  const fullMoveCount = Math.ceil(opening.moveCount / 2);

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://www.playchess.tech" },
      { "@type": "ListItem", position: 2, name: "Chess Openings", item: "https://www.playchess.tech/openings" },
      { "@type": "ListItem", position: 3, name: opening.name, item: `https://www.playchess.tech/openings/${referenceId}` },
    ],
  };

  const openingJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    name: `${opening.name} (${opening.eco})`,
    headline: `${opening.name} — Chess Opening ${opening.eco}`,
    description: `The ${opening.name} is a chess opening classified under ECO code ${opening.eco} (${ecoCategory?.name ?? "Chess Openings"}), reached after the moves ${opening.pgn}.`,
    url: `https://www.playchess.tech/openings/${referenceId}`,
    mainEntityOfPage: `https://www.playchess.tech/openings/${referenceId}`,
    author: { "@type": "Organization", name: "ReplayChess", url: "https://www.playchess.tech" },
    publisher: { "@type": "Organization", name: "ReplayChess", url: "https://www.playchess.tech" },
    about: {
      "@type": "Thing",
      name: opening.name,
      description: `Chess opening ${opening.eco} — ${opening.name}`,
    },
  };

  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(openingJsonLd) }}
      />

      {/* Grid background */}
      <div
        className="fixed inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 sm:pt-36 pb-28 sm:pb-16">
        {/* Back link */}
        <Link
          href="/openings"
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="inline-flex items-center gap-2 text-xs text-cb-text-muted hover:text-cb-text-secondary transition-colors uppercase tracking-widest mb-8"
        >
          ← All Openings
        </Link>

        <div className="lg:grid lg:grid-cols-[1fr_auto] lg:gap-12">
          {/* Left column — text content */}
          <div>
            {/* Header */}
            <div className="mb-8 lg:mb-12 text-center lg:text-left">
              <div className="flex items-center justify-center lg:justify-start gap-3 mb-4">
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-xs px-2 py-1 border border-cb-border text-cb-text-secondary font-medium"
                >
                  {opening.eco}
                </span>
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[10px] text-cb-text-faint uppercase tracking-wider"
                >
                  {opening.moveCount} plies · {opening.sideToMove} to move
                </span>
              </div>
              <h1
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-4xl sm:text-5xl text-cb-text mb-4"
              >
                {opening.name}
              </h1>

              {/* Definition block — optimized for AI extraction */}
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-sm text-cb-text-muted leading-relaxed max-w-2xl mx-auto lg:mx-0"
              >
                The {opening.name} is a chess opening classified under ECO code {opening.eco}
                {ecoCategory && <> in the {ecoCategory.name} family, {ecoCategory.description}</>}.
                {" "}It is reached after {fullMoveCount} move{fullMoveCount !== 1 ? "s" : ""}: {opening.pgn}.
                {" "}The resulting position leaves {opening.sideToMove} to move.
              </p>
            </div>

            {/* Mobile: board + play button only */}
            <div className="lg:hidden flex flex-col items-center">
              <OpeningBoardPreview fen={opening.fen} pgn={opening.pgn} />
              <div className="fixed bottom-0 left-0 right-0 z-50 p-3 bg-cb-backdrop backdrop-blur-sm border-t border-cb-border sm:static sm:bg-transparent sm:p-0 sm:border-0 sm:backdrop-blur-none sm:mt-8 sm:mb-4">
                <Link
                  href={`/play?opening=${opening.referenceId}`}
                  className="group relative overflow-hidden px-8 py-3 bg-cb-accent text-cb-accent-fg transition-all duration-300 block text-center"
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                  <span className="relative text-sm font-medium text-cb-accent-fg group-hover:text-cb-text transition-colors duration-300">
                    Play from this position
                  </span>
                </Link>
              </div>
            </div>

            {/* Desktop: full details */}
            <div className="hidden lg:block">
              <div className="h-px w-full bg-cb-hover mb-12" />

              {/* Moves */}
              <section className="mb-12">
                <h2
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary mb-4"
                >
                  Moves
                </h2>
                <div className="border border-cb-border p-6 bg-cb-hover">
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-lg text-cb-text-secondary font-mono tracking-wide"
                  >
                    {opening.pgn}
                  </p>
                </div>
              </section>

              {/* FEN */}
              <section className="mb-12">
                <h2
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary mb-4"
                >
                  Resulting Position (FEN)
                </h2>
                <div className="border border-cb-border p-4 bg-cb-hover">
                  <code
                    className="text-xs text-cb-text-muted break-all"
                    style={{ fontFamily: "'Geist Mono', monospace" }}
                  >
                    {opening.fen}
                  </code>
                </div>
              </section>

              {/* Play CTA */}
              <div className="flex gap-4">
                <Link
                  href={`/play?opening=${opening.referenceId}`}
                  className="group relative overflow-hidden px-8 py-3 bg-cb-accent text-cb-accent-fg transition-all duration-300"
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                  <span className="relative text-sm font-medium text-cb-accent-fg group-hover:text-cb-text transition-colors duration-300">
                    Play from this position
                  </span>
                </Link>
              </div>
            </div>
          </div>

          {/* Right column — sticky board (desktop only) */}
          <div className="hidden lg:block lg:sticky lg:top-36 lg:self-start">
            <OpeningBoardPreview fen={opening.fen} />
          </div>
        </div>

        {/* Explore More — internal linking */}
        <div className="mt-16 pt-12 border-t border-cb-hover">
          <h2
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary mb-6"
          >
            Explore More
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-cb-hover">
            {ecoCategory && (
              <Link
                href={`/openings?q=${ecoLetter}`}
                className="group bg-cb-bg p-5 hover:bg-cb-hover transition-colors"
              >
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-sm text-cb-text group-hover:text-cb-text-secondary transition-colors"
                >
                  {ecoCategory.name} ({ecoLetter})
                </p>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[11px] text-cb-text-faint mt-1"
                >
                  Browse all ECO {ecoLetter} openings
                </p>
              </Link>
            )}
            <Link
              href="/openings"
              className="group bg-cb-bg p-5 hover:bg-cb-hover transition-colors"
            >
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-sm text-cb-text group-hover:text-cb-text-secondary transition-colors"
              >
                All Chess Openings
              </p>
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-[11px] text-cb-text-faint mt-1"
              >
                Browse 3,600+ openings by ECO code
              </p>
            </Link>
            <Link
              href="/legends"
              className="group bg-cb-bg p-5 hover:bg-cb-hover transition-colors"
            >
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-sm text-cb-text group-hover:text-cb-text-secondary transition-colors"
              >
                Chess Legends
              </p>
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-[11px] text-cb-text-faint mt-1"
              >
                Discover the greatest chess players in history
              </p>
            </Link>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
