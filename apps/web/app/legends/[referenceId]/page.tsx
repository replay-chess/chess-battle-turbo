import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { safeJsonLd } from "@/lib/seo";
import { Navbar } from "../../components/Navbar";
import { Footer } from "../../components/Footer";


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
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(personJsonLd) }}
      />

      {/* Grid background */}
      <div
        className="fixed inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 sm:pt-36 pb-16">
        {/* Back link */}
        <Link
          href="/legends"
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="inline-flex items-center gap-2 text-xs text-white/30 hover:text-white/60 transition-colors uppercase tracking-widest mb-8"
        >
          ← All Legends
        </Link>

        {/* Hero */}
        <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left gap-6 mb-12">
          {legend.profilePhotoUrl ? (
            <img
              src={legend.profilePhotoUrl}
              alt={legend.name}
              className="w-24 h-24 sm:w-32 sm:h-32 object-cover border border-white/10"
            />
          ) : (
            <div className="w-24 h-24 sm:w-32 sm:h-32 border border-white/10 flex items-center justify-center text-white/15 text-5xl">
              ♚
            </div>
          )}

          <div className="flex-1">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
              <h1
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-4xl sm:text-5xl text-white"
              >
                {legend.name}
              </h1>
              <Link
                href={`/play?legend=${legend.referenceId}`}
                className="group relative inline-block overflow-hidden px-8 py-3 bg-white text-black transition-all duration-300 sm:flex-shrink-0"
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                <span className="absolute inset-0 bg-black origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                <span className="relative text-sm font-medium text-black group-hover:text-white transition-colors duration-300">
                  Play as {legend.name}
                </span>
              </Link>
            </div>
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 mb-4">
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-[10px] px-2 py-0.5 border border-white/15 text-white/50 uppercase tracking-wider"
              >
                {legend.era}
              </span>
              {legend.nationality && (
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[10px] text-white/30 uppercase tracking-wider"
                >
                  {legend.nationality}
                </span>
              )}
              {legend.peakRating && (
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[10px] text-white/30"
                >
                  Peak Rating: {legend.peakRating}
                </span>
              )}
              {legend.birthYear && (
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[10px] text-white/30"
                >
                  {legend.birthYear}–{legend.deathYear ?? "present"}
                </span>
              )}
            </div>
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-sm text-white/40 leading-relaxed"
            >
              {legend.shortDescription}
            </p>
          </div>
        </div>

        <div className="h-px w-full bg-white/[0.06] mb-12" />

        {/* Playing Style */}
        {legend.playingStyle && (
          <section className="mb-12">
            <h2
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-xs font-medium uppercase tracking-[0.2em] text-white/50 mb-4"
            >
              Playing Style
            </h2>
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-sm text-white/50 leading-relaxed"
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
              className="text-xs font-medium uppercase tracking-[0.2em] text-white/50 mb-4"
            >
              Achievements
            </h2>
            <ul className="space-y-2">
              {achievements.map((achievement, i) => (
                <li
                  key={i}
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="flex items-start gap-3 text-sm text-white/40"
                >
                  <span className="text-white/15 mt-0.5">◆</span>
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
              className="text-xs font-medium uppercase tracking-[0.2em] text-white/50 mb-4"
            >
              Famous Games
            </h2>
            <div className="space-y-2">
              {famousGames.map((game, i) => (
                <div
                  key={i}
                  className="border border-white/[0.06] p-4 flex items-center justify-between"
                >
                  <div>
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-sm text-white/60"
                    >
                      {game.title ?? `Game ${i + 1}`}
                    </p>
                    {game.year && (
                      <p
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-[10px] text-white/25 mt-0.5"
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
              className="text-xs font-medium uppercase tracking-[0.2em] text-white/50 mb-4"
            >
              Positions in Database
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-white/[0.06]">
              {allPositions.map((pos) => (
                <div
                  key={pos.referenceId}
                  className="bg-black p-4 flex items-center justify-between"
                >
                  <div>
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-sm text-white/50"
                    >
                      {pos.whitePlayerName ?? "White"} vs {pos.blackPlayerName ?? "Black"}
                    </p>
                    {pos.tournamentName && (
                      <p
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-[10px] text-white/25 mt-0.5"
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
      </div>

      <Footer />
    </div>
  );
}
