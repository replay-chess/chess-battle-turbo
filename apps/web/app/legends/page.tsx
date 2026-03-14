import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";


const eraOrder = [
  "Romantic Era",
  "Classical Era",
  "Hypermodern Era",
  "Soviet Era",
  "Modern Era",
  "Contemporary Era",
];

export default async function LegendsPage() {
  const legends = await prisma.legend.findMany({
    where: { isActive: true, isVisible: true },
    orderBy: [{ era: "asc" }, { name: "asc" }],
    select: {
      referenceId: true,
      name: true,
      era: true,
      peakRating: true,
      nationality: true,
      shortDescription: true,
      profilePhotoUrl: true,
      birthYear: true,
      deathYear: true,
    },
  });

  // Group by era
  const grouped = new Map<string, typeof legends>();
  for (const legend of legends) {
    const list = grouped.get(legend.era) ?? [];
    list.push(legend);
    grouped.set(legend.era, list);
  }

  // Sort eras by known order, unknown eras at end
  const sortedEras = [...grouped.keys()].sort(
    (a, b) => (eraOrder.indexOf(a) === -1 ? 999 : eraOrder.indexOf(a)) - (eraOrder.indexOf(b) === -1 ? 999 : eraOrder.indexOf(b))
  );

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

      {/* Hero */}
      <section className="relative pt-32 pb-12 sm:pt-40 sm:pb-16 px-6">
        <div className="max-w-7xl mx-auto text-center">
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="h-px w-12 bg-cb-border-strong" />
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted text-[10px] tracking-[0.4em] uppercase"
            >
              Hall of Fame
            </span>
            <div className="h-px w-12 bg-cb-border-strong" />
          </div>
          <h1
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="text-5xl sm:text-6xl md:text-7xl text-cb-text mb-4"
          >
            Chess Legends
          </h1>
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-lg text-cb-text-muted max-w-xl mx-auto"
          >
            The greatest minds to ever grace the 64 squares.
          </p>
        </div>
      </section>

      <div className="h-px w-full bg-gradient-to-r from-transparent via-cb-border to-transparent" />

      {/* Legends grouped by era */}
      <section className="relative py-12 sm:py-16 px-6">
        <div className="max-w-7xl mx-auto space-y-16">
          {sortedEras.map((era) => {
            const eraLegends = grouped.get(era)!;
            return (
              <div key={era}>
                <div className="flex items-center gap-4 mb-8">
                  <h2
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary"
                  >
                    {era}
                  </h2>
                  <div className="flex-1 h-px bg-cb-hover" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-cb-hover">
                  {eraLegends.map((legend) => (
                    <Link
                      key={legend.referenceId}
                      href={`/legends/${legend.referenceId}`}
                      className="group bg-cb-bg p-6 hover:bg-cb-hover transition-colors duration-300"
                    >
                      <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left gap-4 mx-auto sm:mx-0">
                        {legend.profilePhotoUrl ? (
                          <img
                            src={legend.profilePhotoUrl}
                            alt={legend.name}
                            className="w-14 h-14 object-cover border border-cb-border"
                          />
                        ) : (
                          <div className="w-14 h-14 border border-cb-border flex items-center justify-center text-cb-text-faint text-2xl">
                            ♚
                          </div>
                        )}
                        <div className="sm:flex-1 min-w-0">
                          <h3
                            style={{ fontFamily: "'Instrument Serif', serif" }}
                            className="text-lg text-cb-text group-hover:text-cb-text-secondary transition-colors"
                          >
                            {legend.name}
                          </h3>
                          <div className="flex items-center justify-center sm:justify-start gap-2 mt-1">
                            {legend.nationality && (
                              <span
                                style={{ fontFamily: "'Geist', sans-serif" }}
                                className="text-[10px] text-cb-text-muted uppercase tracking-wider"
                              >
                                {legend.nationality}
                              </span>
                            )}
                            {legend.peakRating && (
                              <>
                                <span className="text-cb-text-faint">·</span>
                                <span
                                  style={{ fontFamily: "'Geist', sans-serif" }}
                                  className="text-[10px] text-cb-text-muted"
                                >
                                  Peak {legend.peakRating}
                                </span>
                              </>
                            )}
                            {legend.birthYear && (
                              <>
                                <span className="text-cb-text-faint">·</span>
                                <span
                                  style={{ fontFamily: "'Geist', sans-serif" }}
                                  className="text-[10px] text-cb-text-muted"
                                >
                                  {legend.birthYear}–{legend.deathYear ?? ""}
                                </span>
                              </>
                            )}
                          </div>
                          <p
                            style={{ fontFamily: "'Geist', sans-serif" }}
                            className="text-xs text-cb-text-muted mt-2 line-clamp-2 leading-relaxed"
                          >
                            {legend.shortDescription}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}

          {legends.length === 0 && (
            <div className="text-center py-20">
              <span className="text-cb-text-faint text-6xl block mb-6">♚</span>
              <p
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-cb-text-muted text-xl"
              >
                Legends coming soon
              </p>
            </div>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
}
