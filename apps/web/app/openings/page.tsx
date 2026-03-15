import Link from "next/link";
import { Prisma } from "@/app/generated/prisma";
import { prisma } from "@/lib/prisma";
import { safeJsonLd } from "@/lib/seo";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";

import { OpeningsSearch } from "./OpeningsSearch";

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export default async function OpeningsPage({ searchParams }: Props) {
  const { q } = await searchParams;

  const where: Prisma.OpeningWhereInput = { isActive: true };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { eco: { contains: q, mode: "insensitive" } },
      { pgn: { contains: q, mode: "insensitive" } },
    ];
  }

  const openings = await prisma.opening.findMany({
    where,
    orderBy: [{ eco: "asc" }, { name: "asc" }],
    select: {
      referenceId: true,
      eco: true,
      name: true,
      pgn: true,
      moveCount: true,
    },
  });

  // Group by ECO letter (A, B, C, D, E)
  const grouped = new Map<string, typeof openings>();
  for (const opening of openings) {
    const letter = opening.eco.charAt(0);
    const list = grouped.get(letter) ?? [];
    list.push(opening);
    grouped.set(letter, list);
  }

  const ecoLabels: Record<string, string> = {
    A: "Flank Openings",
    B: "Semi-Open Games",
    C: "Open Games & French",
    D: "Closed & Semi-Closed Games",
    E: "Indian Defences",
  };

  const sortedLetters = [...grouped.keys()].sort();

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Chess Openings Encyclopedia",
    description: "Browse chess openings organized by ECO code — Flank Openings, Semi-Open Games, Open Games, Closed Games, and Indian Defences.",
    numberOfItems: openings.length,
    itemListElement: openings.slice(0, 100).map((opening, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: `${opening.name} (${opening.eco})`,
      url: `https://www.playchess.tech/openings/${opening.referenceId}`,
    })),
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://www.playchess.tech" },
      { "@type": "ListItem", position: 2, name: "Chess Openings", item: "https://www.playchess.tech/openings" },
    ],
  };

  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(itemListJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbJsonLd) }}
      />

      {/* Grid background */}
      <div
        className="fixed inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Hero */}
      <section className="relative pt-32 pb-12 sm:pt-40 sm:pb-16 px-6">
        <div className="max-w-7xl mx-auto text-center">
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="h-px w-12 bg-cb-border-strong" />
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted text-[10px] tracking-[0.4em] uppercase"
            >
              Encyclopedia
            </span>
            <div className="h-px w-12 bg-cb-border-strong" />
          </div>
          <h1
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="text-5xl sm:text-6xl md:text-7xl text-cb-text mb-4"
          >
            Chess Openings
          </h1>
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-lg text-cb-text-muted max-w-xl mx-auto"
          >
            Browse openings by ECO code. Study the moves, then play from the position.
          </p>
          <OpeningsSearch />
        </div>
      </section>

      <div className="h-px w-full bg-gradient-to-r from-transparent via-cb-border to-transparent" />

      {/* Openings grouped by ECO letter */}
      <section className="relative py-12 sm:py-16 px-6">
        <div className="max-w-7xl mx-auto space-y-16">
          {sortedLetters.map((letter) => {
            const letterOpenings = grouped.get(letter)!;
            return (
              <div key={letter}>
                <div className="flex items-center gap-4 mb-8">
                  <h2
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary"
                  >
                    {letter} — {ecoLabels[letter] ?? "Other"}
                  </h2>
                  <div className="flex-1 h-px bg-cb-hover" />
                  <span
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-[10px] text-cb-text-faint"
                  >
                    {letterOpenings.length} openings
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-cb-hover">
                  {letterOpenings.map((opening) => (
                    <Link
                      key={opening.referenceId}
                      href={`/openings/${opening.referenceId}`}
                      className="group bg-cb-bg p-5 hover:bg-cb-hover transition-colors duration-300"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span
                              style={{ fontFamily: "'Geist', sans-serif" }}
                              className="text-[10px] px-1.5 py-0.5 border border-cb-border text-cb-text-muted font-medium"
                            >
                              {opening.eco}
                            </span>
                            <span
                              style={{ fontFamily: "'Geist', sans-serif" }}
                              className="text-[10px] text-cb-text-faint"
                            >
                              {opening.moveCount} plies
                            </span>
                          </div>
                          <h3
                            style={{ fontFamily: "'Instrument Serif', serif" }}
                            className="text-base text-cb-text group-hover:text-cb-text-secondary transition-colors truncate"
                          >
                            {opening.name}
                          </h3>
                          <p
                            style={{ fontFamily: "'Geist', sans-serif" }}
                            className="text-[11px] text-cb-text-faint mt-1 truncate"
                          >
                            {opening.pgn}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}

          {openings.length === 0 && (
            <div className="text-center py-20">
              <span className="text-cb-text-faint text-6xl block mb-6">♞</span>
              <p
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-cb-text-muted text-xl"
              >
                {q ? "No openings match your search" : "Openings coming soon"}
              </p>
            </div>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
}
