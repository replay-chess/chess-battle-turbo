import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Navbar } from "@/app/components/Navbar";
import { Footer } from "@/app/components/Footer";
import { StaticChessBoard } from "@/app/components/StaticChessBoard";
import { BASE_URL, createMetadata, safeJsonLd } from "@/lib/seo";
import {
  getLegendBySlug,
  getVisibleLegends,
  slugifyName,
} from "@/lib/learn-directory";

// Public, indexable biography page for a chess legend. Playing against the
// legend's games stays behind auth (/legends/<referenceId>); this page
// carries the searchable reference content — bio, achievements, style.

interface Props {
  params: Promise<{ slug: string }>;
}

interface FamousGame {
  title?: string;
  fen?: string;
  year?: number;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const legend = await getLegendBySlug(slug).catch(() => null);
  if (!legend) return { robots: { index: false, follow: false } };
  return createMetadata({
    title: `${legend.name} — Chess Legend, Style & Famous Games`,
    description: `${legend.shortDescription} Learn ${legend.name}'s playing style and famous games, then face positions from their games against the engine.`.slice(
      0,
      300,
    ),
    path: `/learn/legends/${slug}`,
    ogType: "legend",
    ogTitle: legend.name,
    noFollow: false,
  });
}

export default async function LegendReferencePage({ params }: Props) {
  const { slug } = await params;
  const legend = await getLegendBySlug(slug).catch(() => null);
  if (!legend || slugifyName(legend.name) !== slug) notFound();

  const achievements = (legend.achievements as string[] | null) ?? [];
  const famousGames = (legend.famousGames as FamousGame[] | null) ?? [];
  const pageUrl = `${BASE_URL}/learn/legends/${slug}`;

  const related = (await getVisibleLegends().catch(() => []))
    .filter((other) => other.referenceId !== legend.referenceId)
    .sort((a, b) =>
      a.era === legend.era && b.era !== legend.era
        ? -1
        : b.era === legend.era && a.era !== legend.era
          ? 1
          : 0,
    )
    .slice(0, 6);

  const lifespan =
    legend.birthYear &&
    `${legend.birthYear}–${legend.deathYear ?? "present"}`;

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: "Chess Legends",
        item: `${BASE_URL}/learn/legends`,
      },
      { "@type": "ListItem", position: 3, name: legend.name, item: pageUrl },
    ],
  };

  const personJsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: legend.name,
    url: pageUrl,
    ...(legend.profilePhotoUrl && { image: legend.profilePhotoUrl }),
    ...(legend.nationality && { nationality: legend.nationality }),
    ...(legend.birthYear && { birthDate: `${legend.birthYear}` }),
    ...(legend.deathYear && { deathDate: `${legend.deathYear}` }),
    description: legend.shortDescription,
    jobTitle: "Chess Grandmaster",
    knowsAbout: ["Chess", "Chess Strategy", "Chess Openings"],
    ...(legend.peakRating && { award: `Peak Rating: ${legend.peakRating}` }),
    ...(achievements.length > 0 && {
      hasCredential: achievements.map((achievement) => ({
        "@type": "EducationalOccupationalCredential",
        credentialCategory: "Chess Achievement",
        name: achievement,
      })),
    }),
  };

  const facts: [string, string][] = [
    ["Era", legend.era],
    ...(legend.nationality
      ? ([["Nationality", legend.nationality]] as [string, string][])
      : []),
    ...(legend.peakRating
      ? ([["Peak rating", String(legend.peakRating)]] as [string, string][])
      : []),
    ...(lifespan ? ([["Years", lifespan]] as [string, string][]) : []),
  ];

  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar breadcrumbLabel={legend.name} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(personJsonLd) }}
      />
      <main>
        <header className="border-b border-cb-border px-6 pb-16 pt-32 sm:pt-40">
          <div className="mx-auto max-w-4xl">
            <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-cb-text-muted">
              Chess legend · {legend.era}
            </p>
            <h1 className="mt-5 font-serif text-4xl leading-tight sm:text-5xl md:text-6xl">
              {legend.name}
            </h1>
            <p className="mt-6 max-w-3xl font-sans text-lg leading-8 text-cb-text-muted">
              {legend.shortDescription}
            </p>
            <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt className="font-sans text-[10px] uppercase tracking-[0.2em] text-cb-text-faint">
                    {label}
                  </dt>
                  <dd className="mt-1 font-sans text-sm text-cb-text-secondary">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </header>

        <article className="mx-auto max-w-4xl px-6 py-16">
          {legend.playingStyle && (
            <section>
              <h2 className="font-serif text-4xl">Playing style</h2>
              <p className="mt-5 font-sans text-base leading-8 text-cb-text-muted">
                {legend.playingStyle}
              </p>
            </section>
          )}

          {achievements.length > 0 && (
            <section className="mt-14">
              <h2 className="font-serif text-4xl">Achievements</h2>
              <ul className="mt-6 space-y-3">
                {achievements.map((achievement) => (
                  <li
                    key={achievement}
                    className="border-l-2 border-cb-border-strong pl-4 font-sans text-base leading-7 text-cb-text-muted"
                  >
                    {achievement}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {famousGames.length > 0 && (
            <section className="mt-14">
              <h2 className="font-serif text-4xl">Famous games</h2>
              <div className="mt-6 grid grid-cols-1 gap-8 sm:grid-cols-2">
                {famousGames.slice(0, 4).map((game, index) => (
                  <div key={index}>
                    {game.fen && (
                      <StaticChessBoard
                        fen={game.fen}
                        caption={
                          game.title
                            ? `${game.title}${game.year ? ` (${game.year})` : ""}`
                            : undefined
                        }
                      />
                    )}
                    {!game.fen && game.title && (
                      <p className="font-sans text-sm text-cb-text-muted">
                        {game.title}
                        {game.year ? ` (${game.year})` : ""}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="mt-14 flex flex-wrap gap-4">
            <Link
              href={`/legends/${legend.referenceId}`}
              className="inline-flex items-center gap-2 bg-cb-accent px-5 py-3 font-sans text-xs uppercase tracking-[0.12em] text-cb-accent-fg"
            >
              Play {legend.name}&apos;s positions{" "}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/learn/legends"
              className="inline-flex items-center gap-2 border border-cb-border-strong px-5 py-3 font-sans text-xs uppercase tracking-[0.12em]"
            >
              How to study famous games
            </Link>
          </div>

          {related.length > 0 && (
            <section className="mt-16 border-t border-cb-hover pt-12">
              <h2 className="font-sans text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary">
                More chess legends
              </h2>
              <ul className="mt-6 grid grid-cols-1 gap-px bg-cb-hover sm:grid-cols-2 lg:grid-cols-3">
                {related.map((other) => (
                  <li key={other.referenceId} className="bg-cb-bg">
                    <Link
                      href={`/learn/legends/${slugifyName(other.name)}`}
                      className="block p-5 transition-colors hover:bg-cb-hover"
                    >
                      <p className="font-sans text-sm text-cb-text">
                        {other.name}
                      </p>
                      <p className="mt-1 font-sans text-[11px] text-cb-text-faint">
                        {other.era}
                        {other.peakRating ? ` · Peak ${other.peakRating}` : ""}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
      </main>
      <Footer />
    </div>
  );
}
