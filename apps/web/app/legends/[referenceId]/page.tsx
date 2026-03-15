import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { safeJsonLd } from "@/lib/seo";
import { Navbar } from "../../components/Navbar";
import { Footer } from "../../components/Footer";
import { ChallengeLegendButton } from "./ChallengeLegendButton";


interface Props {
  params: Promise<{ referenceId: string }>;
}

export default async function LegendDetailPage({ params }: Props) {
  const { referenceId } = await params;

  const legend = await prisma.legend.findUnique({
    where: { referenceId },
    include: {
      gamesAsWhite: {
        where: { isActive: true },
        take: 10,
        select: {
          referenceId: true,
          fen: true,
          whitePlayerName: true,
          blackPlayerName: true,
          tournamentName: true,
          eventDate: true,
          moveNumber: true,
        },
      },
      gamesAsBlack: {
        where: { isActive: true },
        take: 10,
        select: {
          referenceId: true,
          fen: true,
          whitePlayerName: true,
          blackPlayerName: true,
          tournamentName: true,
          eventDate: true,
          moveNumber: true,
        },
      },
    },
  });

  if (!legend || !legend.isVisible || !legend.isActive) {
    notFound();
  }

  const achievements = (legend.achievements as string[] | null) ?? [];
  const famousGames = (legend.famousGames as Array<{ title?: string; fen?: string; year?: number }> | null) ?? [];
  const allPositions = [...legend.gamesAsWhite, ...legend.gamesAsBlack];

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://www.playchess.tech" },
      { "@type": "ListItem", position: 2, name: "Chess Legends", item: "https://www.playchess.tech/legends" },
      { "@type": "ListItem", position: 3, name: legend.name, item: `https://www.playchess.tech/legends/${referenceId}` },
    ],
  };

  const personJsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: legend.name,
    url: `https://www.playchess.tech/legends/${referenceId}`,
    ...(legend.profilePhotoUrl && { image: legend.profilePhotoUrl }),
    ...(legend.nationality && { nationality: legend.nationality }),
    ...(legend.birthYear && { birthDate: `${legend.birthYear}` }),
    ...(legend.deathYear && { deathDate: `${legend.deathYear}` }),
    description: legend.shortDescription,
    jobTitle: "Chess Grandmaster",
    knowsAbout: ["Chess", "Chess Strategy", "Chess Openings"],
    ...(legend.peakRating && { award: `Peak Rating: ${legend.peakRating}` }),
    ...(achievements.length > 0 && {
      hasCredential: achievements.map((a) => ({
        "@type": "EducationalOccupationalCredential",
        credentialCategory: "Chess Achievement",
        name: a,
      })),
    }),
    sameAs: `https://www.playchess.tech/legends/${referenceId}`,
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
        dangerouslySetInnerHTML={{ __html: safeJsonLd(personJsonLd) }}
      />

      {/* Grid background */}
      <div
        className="fixed inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 sm:pt-36 pb-28 sm:pb-16">
        {/* Back link */}
        <Link
          href="/legends"
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="inline-flex items-center gap-2 text-xs text-cb-text-muted hover:text-cb-text-secondary transition-colors uppercase tracking-widest mb-8"
        >
          ← All Legends
        </Link>

        {/* Hero */}
        <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left gap-6 mb-12">
          {legend.profilePhotoUrl ? (
            <img
              src={legend.profilePhotoUrl}
              alt={legend.name}
              className="w-24 h-24 sm:w-32 sm:h-32 object-cover border border-cb-border"
            />
          ) : (
            <div className="w-24 h-24 sm:w-32 sm:h-32 border border-cb-border flex items-center justify-center text-cb-text-faint text-5xl">
              ♚
            </div>
          )}

          <div className="flex-1">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
              <h1
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-4xl sm:text-5xl text-cb-text"
              >
                {legend.name}
              </h1>
              <div className="fixed bottom-0 left-0 right-0 z-50 p-3 bg-cb-backdrop backdrop-blur-sm border-t border-cb-border flex flex-row gap-2 sm:static sm:bg-transparent sm:p-0 sm:border-0 sm:backdrop-blur-none sm:flex-shrink-0">
                <Link
                  href={`/play?legend=${legend.referenceId}`}
                  className="group relative flex-1 sm:flex-initial inline-flex items-center justify-center overflow-hidden px-3 py-3 sm:px-8 bg-cb-accent text-cb-accent-fg transition-all duration-300 text-center"
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                  <span className="relative text-sm font-medium text-cb-accent-fg group-hover:text-cb-text transition-colors duration-300 truncate">
                    <span className="sm:hidden">{legend.name} vs Bot</span>
                    <span className="hidden sm:inline">Play as {legend.name}</span>
                  </span>
                </Link>
                <ChallengeLegendButton
                  legendReferenceId={legend.referenceId}
                  legendName={legend.name}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 mb-4">
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-[10px] px-2 py-0.5 border border-cb-border text-cb-text-secondary uppercase tracking-wider"
              >
                {legend.era}
              </span>
              {legend.nationality && (
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[10px] text-cb-text-muted uppercase tracking-wider"
                >
                  {legend.nationality}
                </span>
              )}
              {legend.peakRating && (
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[10px] text-cb-text-muted"
                >
                  Peak Rating: {legend.peakRating}
                </span>
              )}
              {legend.birthYear && (
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[10px] text-cb-text-muted"
                >
                  {legend.birthYear}–{legend.deathYear ?? "present"}
                </span>
              )}
            </div>
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-sm text-cb-text-muted leading-relaxed"
            >
              {legend.shortDescription}
            </p>
          </div>
        </div>

        <div className="h-px w-full bg-cb-hover mb-12" />

        {/* Playing Style */}
        {legend.playingStyle && (
          <section className="mb-12">
            <h2
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary mb-4"
            >
              Playing Style
            </h2>
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-sm text-cb-text-secondary leading-relaxed"
            >
              {legend.playingStyle}
            </p>
          </section>
        )}

        {/* Achievements */}
        {achievements.length > 0 && (
          <section className="mb-12">
            <h2
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary mb-4"
            >
              Achievements
            </h2>
            <ul className="space-y-2">
              {achievements.map((achievement, i) => (
                <li
                  key={i}
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="flex items-start gap-3 text-sm text-cb-text-muted"
                >
                  <span className="text-cb-text-faint mt-0.5">◆</span>
                  {achievement}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Famous Games (from JSON field) */}
        {famousGames.length > 0 && (
          <section className="mb-12">
            <h2
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary mb-4"
            >
              Famous Games
            </h2>
            <div className="space-y-2">
              {famousGames.map((game, i) => (
                <div
                  key={i}
                  className="border border-cb-border p-4 flex items-center justify-between"
                >
                  <div>
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-sm text-cb-text-secondary"
                    >
                      {game.title ?? `Game ${i + 1}`}
                    </p>
                    {game.year && (
                      <p
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-[10px] text-cb-text-faint mt-0.5"
                      >
                        {game.year}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Positions from DB */}
        {allPositions.length > 0 && (
          <section className="mb-12">
            <h2
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary mb-4"
            >
              Positions in Database
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-cb-hover">
              {allPositions.map((pos) => (
                <div
                  key={pos.referenceId}
                  className="bg-cb-bg p-4 flex items-center justify-between"
                >
                  <div>
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-sm text-cb-text-secondary"
                    >
                      {pos.whitePlayerName ?? "White"} vs {pos.blackPlayerName ?? "Black"}
                    </p>
                    {pos.tournamentName && (
                      <p
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-[10px] text-cb-text-faint mt-0.5"
                      >
                        {pos.tournamentName}
                        {pos.eventDate && ` · ${new Date(pos.eventDate).getFullYear()}`}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Explore More — internal linking */}
        <div className="pt-12 border-t border-cb-hover">
          <h2
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary mb-6"
          >
            Explore More
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-cb-hover">
            <Link
              href="/legends"
              className="group bg-cb-bg p-5 hover:bg-cb-hover transition-colors"
            >
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-sm text-cb-text group-hover:text-cb-text-secondary transition-colors"
              >
                All Chess Legends
              </p>
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-[11px] text-cb-text-faint mt-1"
              >
                Explore 50+ legends across 6 chess eras
              </p>
            </Link>
            <Link
              href="/openings"
              className="group bg-cb-bg p-5 hover:bg-cb-hover transition-colors"
            >
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-sm text-cb-text group-hover:text-cb-text-secondary transition-colors"
              >
                Chess Openings
              </p>
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-[11px] text-cb-text-faint mt-1"
              >
                Browse 3,600+ openings by ECO code
              </p>
            </Link>
            <Link
              href={`/play?legend=${legend.referenceId}`}
              className="group bg-cb-bg p-5 hover:bg-cb-hover transition-colors"
            >
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-sm text-cb-text group-hover:text-cb-text-secondary transition-colors"
              >
                Play as {legend.name}
              </p>
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-[11px] text-cb-text-faint mt-1"
              >
                Replay famous positions against a bot
              </p>
            </Link>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
