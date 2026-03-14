import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Navbar } from "../../components/Navbar";
import { Footer } from "../../components/Footer";

import { OpeningBoardPreview } from "./OpeningBoardPreview";

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

  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar />

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
      </div>

      <Footer />
    </div>
  );
}
