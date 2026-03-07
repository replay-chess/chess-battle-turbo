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
    <div className="min-h-screen bg-black text-white">
      <Navbar />

      {/* Grid background */}
      <div
        className="fixed inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 sm:pt-36 pb-16">
        {/* Back link */}
        <Link
          href="/openings"
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="inline-flex items-center gap-2 text-xs text-white/30 hover:text-white/60 transition-colors uppercase tracking-widest mb-8"
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
                  className="text-xs px-2 py-1 border border-white/15 text-white/50 font-medium"
                >
                  {opening.eco}
                </span>
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[10px] text-white/25 uppercase tracking-wider"
                >
                  {opening.moveCount} plies · {opening.sideToMove} to move
                </span>
              </div>
              <h1
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-4xl sm:text-5xl text-white mb-4"
              >
                {opening.name}
              </h1>
            </div>

            {/* Mobile: board + play button only */}
            <div className="lg:hidden flex flex-col items-center">
              <OpeningBoardPreview fen={opening.fen} pgn={opening.pgn} />
              <div className="mt-8 mb-4">
                <Link
                  href={`/play?opening=${opening.referenceId}`}
                  className="group relative overflow-hidden px-8 py-3 bg-white text-black transition-all duration-300"
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  <span className="absolute inset-0 bg-black origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                  <span className="relative text-sm font-medium text-black group-hover:text-white transition-colors duration-300">
                    Play from this position
                  </span>
                </Link>
              </div>
            </div>

            {/* Desktop: full details */}
            <div className="hidden lg:block">
              <div className="h-px w-full bg-white/[0.06] mb-12" />

              {/* Moves */}
              <section className="mb-12">
                <h2
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-xs font-medium uppercase tracking-[0.2em] text-white/50 mb-4"
                >
                  Moves
                </h2>
                <div className="border border-white/[0.06] p-6 bg-white/[0.01]">
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-lg text-white/70 font-mono tracking-wide"
                  >
                    {opening.pgn}
                  </p>
                </div>
              </section>

              {/* FEN */}
              <section className="mb-12">
                <h2
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-xs font-medium uppercase tracking-[0.2em] text-white/50 mb-4"
                >
                  Resulting Position (FEN)
                </h2>
                <div className="border border-white/[0.06] p-4 bg-white/[0.01]">
                  <code
                    className="text-xs text-white/40 break-all"
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
                  className="group relative overflow-hidden px-8 py-3 bg-white text-black transition-all duration-300"
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  <span className="absolute inset-0 bg-black origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                  <span className="relative text-sm font-medium text-black group-hover:text-white transition-colors duration-300">
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
