import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Navbar } from "@/app/components/Navbar";
import { Footer } from "@/app/components/Footer";
import { BASE_URL, createMetadata, safeJsonLd } from "@/lib/seo";
import {
  ECO_FAMILIES,
  buildOpeningSlug,
  getCanonicalOpenings,
  getEcoFamily,
} from "@/lib/learn-directory";

// Public directory page for one ECO family (A–E). Lists every named opening
// in the family with links to the individual reference pages — the internal
// linking hub that lets crawlers discover the whole opening database.

interface Props {
  params: Promise<{ letter: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { letter } = await params;
  const family = getEcoFamily(letter);
  if (!family) return { robots: { index: false, follow: false } };
  return createMetadata({
    title: `ECO ${family.letter} Chess Openings: ${family.name}`,
    description: `Browse every ECO ${family.letter} chess opening — ${family.name}, ${family.description}. Move orders, positions, and engine training for each line.`,
    path: `/learn/openings/eco/${letter.toLowerCase()}`,
    noFollow: false,
  });
}

export default async function EcoFamilyPage({ params }: Props) {
  const { letter } = await params;
  const family = getEcoFamily(letter);
  if (!family || letter !== letter.toLowerCase()) notFound();

  const allOpenings = await getCanonicalOpenings().catch(() => []);
  const openings = allOpenings.filter(
    (opening) => opening.eco.charAt(0) === family.letter,
  );
  if (openings.length === 0) notFound();

  // Group by full ECO code (A00, A01, ...) for scannable structure
  const byCode = new Map<string, typeof openings>();
  for (const opening of openings) {
    const group = byCode.get(opening.eco) ?? [];
    group.push(opening);
    byCode.set(opening.eco, group);
  }

  const pageUrl = `${BASE_URL}/learn/openings/eco/${letter}`;
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
      {
        "@type": "ListItem",
        position: 3,
        name: `ECO ${family.letter}: ${family.name}`,
        item: pageUrl,
      },
    ],
  };

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `ECO ${family.letter} Chess Openings: ${family.name}`,
    description: `Directory of ${openings.length} named chess openings in the ECO ${family.letter} classification.`,
    url: pageUrl,
    isPartOf: { "@id": `${BASE_URL}/#organization` },
  };

  const otherFamilies = ECO_FAMILIES.filter(
    (other) => other.letter !== family.letter,
  );

  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar breadcrumbLabel={`ECO ${family.letter} Openings`} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(collectionJsonLd) }}
      />
      <main>
        <header className="border-b border-cb-border px-6 pb-16 pt-32 sm:pt-40">
          <div className="mx-auto max-w-4xl">
            <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-cb-text-muted">
              Opening database · ECO {family.letter}
            </p>
            <h1 className="mt-5 font-serif text-4xl leading-tight sm:text-5xl md:text-6xl">
              {family.name}
            </h1>
            <p className="mt-6 max-w-3xl font-sans text-lg leading-8 text-cb-text-muted">
              ECO {family.letter} openings are {family.description}. This
              directory covers {openings.length} named lines — open any of them
              for the move order, the resulting position, and a board to train
              it against the engine.
            </p>
          </div>
        </header>

        <div className="mx-auto max-w-4xl px-6 py-16">
          {[...byCode.entries()].map(([code, group]) => (
            <section key={code} className="mb-10">
              <h2 className="border-b border-cb-hover pb-2 font-sans text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary">
                {code}
              </h2>
              <ul className="mt-4 grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
                {group.map((opening) => (
                  <li key={opening.referenceId}>
                    <Link
                      href={`/learn/openings/${buildOpeningSlug(opening.name, opening.eco)}`}
                      className="group flex items-baseline justify-between gap-3 py-2"
                    >
                      <span className="font-sans text-sm text-cb-text-muted transition-colors group-hover:text-cb-text">
                        {opening.name}
                      </span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-cb-text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section className="mt-16 border-t border-cb-hover pt-12">
            <h2 className="font-sans text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary">
              Other ECO families
            </h2>
            <ul className="mt-6 grid grid-cols-1 gap-px bg-cb-hover sm:grid-cols-2">
              {otherFamilies.map((other) => (
                <li key={other.letter} className="bg-cb-bg">
                  <Link
                    href={`/learn/openings/eco/${other.letter.toLowerCase()}`}
                    className="block p-5 transition-colors hover:bg-cb-hover"
                  >
                    <p className="font-sans text-sm text-cb-text">
                      ECO {other.letter} — {other.name}
                    </p>
                    <p className="mt-1 font-sans text-[11px] leading-5 text-cb-text-faint">
                      Openings {other.description}.
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
