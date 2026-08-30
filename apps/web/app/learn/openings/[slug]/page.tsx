import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Chess } from "chess.js";
import { ArrowRight } from "lucide-react";
import { Navbar } from "@/app/components/Navbar";
import { Footer } from "@/app/components/Footer";
import { StaticChessBoard } from "@/app/components/StaticChessBoard";
import { BASE_URL, createMetadata, safeJsonLd } from "@/lib/seo";
import {
  buildOpeningSlug,
  getEcoFamily,
  getOpeningBySlug,
} from "@/lib/learn-directory";

// Public, indexable opening reference page. The interactive training flow
// stays behind auth (/openings, /play); this page carries the searchable
// reference content — name, ECO classification, move order, and position.

interface Props {
  params: Promise<{ slug: string }>;
}

/** Parses a PGN into [white, black?] SAN pairs; null when unparseable. */
function getMovePairs(pgn: string): [string, string | undefined][] | null {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    const history = chess.history();
    const pairs: [string, string | undefined][] = [];
    for (let i = 0; i < history.length; i += 2) {
      pairs.push([history[i]!, history[i + 1]]);
    }
    return pairs;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const result = await getOpeningBySlug(slug).catch(() => null);
  if (!result) {
    return { robots: { index: false, follow: false } };
  }
  const { canonical } = result;
  return createMetadata({
    title: `${canonical.name} (${canonical.eco}) — Moves, Position & Plans`,
    description: `The ${canonical.name} is a chess opening classified as ECO ${canonical.eco}, reached after ${canonical.pgn}. See the move order and resulting position, then train it against the engine.`.slice(
      0,
      300,
    ),
    path: `/learn/openings/${slug}`,
    ogType: "opening",
    ogTitle: canonical.name,
    noFollow: false,
  });
}

export default async function OpeningReferencePage({ params }: Props) {
  const { slug } = await params;
  const result = await getOpeningBySlug(slug).catch(() => null);
  if (!result) notFound();

  // The canonical slug for this (eco, name); redirect-worthy mismatches just 404
  const canonicalSlug = buildOpeningSlug(result.canonical.name, result.canonical.eco);
  if (canonicalSlug !== slug) notFound();

  const { canonical, variations, siblings } = result;
  const ecoLetter = canonical.eco.charAt(0);
  const family = getEcoFamily(ecoLetter);
  const fullMoveCount = Math.ceil(canonical.moveCount / 2);
  const movePairs = getMovePairs(canonical.pgn);
  const pageUrl = `${BASE_URL}/learn/openings/${slug}`;

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: "Chess Openings",
        item: `${BASE_URL}/learn/openings`,
      },
      ...(family
        ? [
            {
              "@type": "ListItem",
              position: 3,
              name: `ECO ${ecoLetter}: ${family.name}`,
              item: `${BASE_URL}/learn/openings/eco/${ecoLetter.toLowerCase()}`,
            },
          ]
        : []),
      {
        "@type": "ListItem",
        position: family ? 4 : 3,
        name: canonical.name,
        item: pageUrl,
      },
    ],
  };

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${canonical.name} (${canonical.eco})`,
    description: `Move order, resulting position, and training resources for the ${canonical.name} chess opening.`,
    url: pageUrl,
    mainEntityOfPage: pageUrl,
    dateModified: canonical.updatedAt.toISOString(),
    author: {
      "@type": "Person",
      name: "Rohit Pandit",
      url: `${BASE_URL}/blog/author/rohit-pandit`,
    },
    publisher: { "@id": `${BASE_URL}/#organization` },
  };

  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar breadcrumbLabel={canonical.name} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(articleJsonLd) }}
      />
      <main>
        <header className="border-b border-cb-border px-6 pb-16 pt-32 sm:pt-40">
          <div className="mx-auto max-w-4xl">
            <div className="flex items-center gap-3">
              <span className="border border-cb-border px-2 py-1 font-sans text-xs font-medium text-cb-text-secondary">
                {canonical.eco}
              </span>
              <span className="font-sans text-[10px] uppercase tracking-[0.3em] text-cb-text-muted">
                Chess opening reference
              </span>
            </div>
            <h1 className="mt-5 font-serif text-4xl leading-tight sm:text-5xl md:text-6xl">
              {canonical.name}
            </h1>
            {/* Definition block — optimized for search snippets and AI extraction */}
            <p className="mt-6 max-w-3xl font-sans text-lg leading-8 text-cb-text-muted">
              The {canonical.name} is a chess opening classified under ECO code{" "}
              {canonical.eco}
              {family && (
                <>
                  {" "}
                  in the {family.name} family, {family.description}
                </>
              )}
              . It is reached after {fullMoveCount} move
              {fullMoveCount !== 1 ? "s" : ""}: {canonical.pgn}. The resulting
              position leaves {canonical.sideToMove} to move.
            </p>
          </div>
        </header>

        <article className="mx-auto max-w-4xl px-6 py-16">
          <div className="gap-12 lg:grid lg:grid-cols-[1fr_auto]">
            <div>
              <section>
                <h2 className="font-sans text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary">
                  Move order
                </h2>
                {movePairs ? (
                  <ol className="mt-4 space-y-1 border border-cb-border bg-cb-hover p-6 font-mono text-base text-cb-text-secondary">
                    {movePairs.map(([white, black], index) => (
                      <li key={index} className="flex gap-4">
                        <span className="w-8 text-cb-text-faint">
                          {index + 1}.
                        </span>
                        <span className="w-16">{white}</span>
                        {black && <span className="w-16">{black}</span>}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-4 border border-cb-border bg-cb-hover p-6 font-mono text-base text-cb-text-secondary">
                    {canonical.pgn}
                  </p>
                )}
              </section>

              <section className="mt-12">
                <h2 className="font-sans text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary">
                  Resulting position (FEN)
                </h2>
                <code className="mt-4 block break-all border border-cb-border bg-cb-hover p-4 font-mono text-xs text-cb-text-muted">
                  {canonical.fen}
                </code>
              </section>

              {variations.length > 0 && (
                <section className="mt-12">
                  <h2 className="font-sans text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary">
                    Alternative move orders
                  </h2>
                  <p className="mt-3 font-sans text-sm leading-7 text-cb-text-muted">
                    The {canonical.name} can also be reached through{" "}
                    {variations.length} other move order
                    {variations.length !== 1 ? "s" : ""} in our database:
                  </p>
                  <ul className="mt-4 space-y-2">
                    {variations.map((variation) => (
                      <li
                        key={variation.referenceId}
                        className="border border-cb-border bg-cb-hover p-4 font-mono text-sm text-cb-text-muted"
                      >
                        {variation.pgn}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <div className="mt-12 flex flex-wrap gap-4">
                <Link
                  href={`/play?opening=${canonical.referenceId}`}
                  className="inline-flex items-center gap-2 bg-cb-accent px-5 py-3 font-sans text-xs uppercase tracking-[0.12em] text-cb-accent-fg"
                >
                  Train this opening against the engine{" "}
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/learn/openings"
                  className="inline-flex items-center gap-2 border border-cb-border-strong px-5 py-3 font-sans text-xs uppercase tracking-[0.12em]"
                >
                  How to study openings
                </Link>
              </div>
            </div>

            <div className="mt-12 lg:mt-0 lg:sticky lg:top-36 lg:self-start">
              <StaticChessBoard
                fen={canonical.fen}
                caption={`Position after ${canonical.pgn}`}
              />
            </div>
          </div>

          {siblings.length > 0 && (
            <section className="mt-16 border-t border-cb-hover pt-12">
              <h2 className="font-sans text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary">
                More ECO {canonical.eco} openings
              </h2>
              <ul className="mt-6 grid grid-cols-1 gap-px bg-cb-hover sm:grid-cols-2 lg:grid-cols-3">
                {siblings.map((sibling) => (
                  <li key={sibling.referenceId} className="bg-cb-bg">
                    <Link
                      href={`/learn/openings/${buildOpeningSlug(sibling.name, sibling.eco)}`}
                      className="block p-5 transition-colors hover:bg-cb-hover"
                    >
                      <p className="font-sans text-sm text-cb-text">
                        {sibling.name}
                      </p>
                      <p className="mt-1 font-sans text-[11px] text-cb-text-faint">
                        {sibling.pgn}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
              {family && (
                <p className="mt-6 font-sans text-sm text-cb-text-muted">
                  Browse all{" "}
                  <Link
                    href={`/learn/openings/eco/${ecoLetter.toLowerCase()}`}
                    className="text-cb-text-secondary underline decoration-cb-border-strong underline-offset-4"
                  >
                    ECO {ecoLetter} — {family.name}
                  </Link>
                  .
                </p>
              )}
            </section>
          )}
        </article>
      </main>
      <Footer />
    </div>
  );
}
