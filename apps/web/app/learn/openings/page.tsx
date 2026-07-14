import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Navbar } from "@/app/components/Navbar";
import { Footer } from "@/app/components/Footer";
import { BASE_URL, createMetadata, safeJsonLd } from "@/lib/seo";

export const metadata: Metadata = createMetadata({
  title: "Chess Openings: Learn Plans, Not Move Lists",
  description:
    "Learn how to study chess openings through development, king safety, pawn structures, tactical warnings, and middlegame plans instead of memorizing moves.",
  path: "/learn/openings",
});

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Chess Openings: Learn Plans, Not Move Lists",
  description: metadata.description,
  url: `${BASE_URL}/learn/openings`,
  mainEntityOfPage: `${BASE_URL}/learn/openings`,
  datePublished: "2026-07-14T00:00:00+05:30",
  dateModified: "2026-07-14T00:00:00+05:30",
  author: {
    "@type": "Person",
    name: "Rohit Pandit",
    url: `${BASE_URL}/blog/author/rohit-pandit`,
    sameAs: ["https://x.com/anaestheticdev"],
  },
  publisher: { "@id": `${BASE_URL}/#organization` },
};

export default function OpeningsGuidePage() {
  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar breadcrumbLabel="Opening Guide" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />
      <main>
        <header className="border-b border-cb-border px-6 pb-16 pt-32 sm:pt-40">
          <div className="mx-auto max-w-4xl">
            <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-cb-text-muted">
              Public chess guide
            </p>
            <h1 className="mt-5 font-serif text-5xl leading-tight sm:text-6xl md:text-7xl">
              Chess openings: learn plans, not move lists
            </h1>
            <p className="mt-6 max-w-3xl font-sans text-lg leading-8 text-cb-text-muted">
              An opening is successful when it gives you a playable middlegame
              you understand. Memorization helps only after you can explain what
              each move develops, protects, attacks, or prepares.
            </p>
            <p className="mt-5 font-sans text-sm text-cb-text-muted">
              Written by{" "}
              <Link
                href="/blog/author/rohit-pandit"
                className="text-cb-text-secondary underline decoration-cb-border-strong underline-offset-4"
              >
                Rohit Pandit
              </Link>
            </p>
          </div>
        </header>

        <article className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <section>
            <h2 className="font-serif text-4xl">
              Start with the position’s needs
            </h2>
            <div className="mt-5 space-y-5 font-sans text-base leading-8 text-cb-text-muted">
              <p>
                The opening is a race to make your pieces useful without
                creating weaknesses that follow you into the middlegame. Central
                influence gives pieces routes, development increases the number
                of pieces participating in the game, and king safety lets you
                open the position without losing to a forcing attack.
              </p>
              <p>
                These ideas are more durable than any single move order. When an
                opponent varies early, ask which principle changed. Did they
                neglect the center, move the same piece twice, delay castling,
                or offer a pawn to gain time? That question gives you a
                practical response even when you have left your preparation.
              </p>
            </div>
          </section>

          <section className="mt-14 border-t border-cb-border pt-12">
            <h2 className="font-serif text-4xl">
              Connect moves to pawn structures
            </h2>
            <div className="mt-5 space-y-5 font-sans text-base leading-8 text-cb-text-muted">
              <p>
                Opening names are labels; pawn structures are plans. An isolated
                queen’s pawn can provide activity and open files but may become
                a target after pieces are exchanged. A Carlsbad structure
                suggests minority attacks on one wing and central or kingside
                play on the other. A locked center gives both players time to
                prepare pawn breaks, so the direction of each chain matters.
              </p>
              <p>
                When studying a line, record the usual pawn breaks, the best and
                worst pieces, and which exchange helps each side. Those notes
                remain useful across many move orders. The{" "}
                <Link
                  href="/blog/morphy-anderssen-kings-gambit-rook-invasion"
                  className="text-cb-text-secondary underline decoration-cb-border-strong underline-offset-4"
                >
                  Morphy–Anderssen King&apos;s Gambit
                </Link>{" "}
                shows how a kingside pawn chain can become either an attacking
                asset or a tactical target.
              </p>
            </div>
          </section>

          <section className="mt-14 border-t border-cb-border pt-12">
            <h2 className="font-serif text-4xl">
              Build a compact opening file
            </h2>
            <div className="mt-5 space-y-5 font-sans text-base leading-8 text-cb-text-muted">
              <p>
                Choose one dependable setup against each major first move. Keep
                the file small enough to review: a main line, the opponent’s
                most common alternatives, one model game, and a short list of
                tactical warnings. Add moves only when a real game shows that
                you need them.
              </p>
              <p>
                After every game, find the first moment you no longer knew the
                plan. Do not automatically blame the first move that differed
                from a database. The useful correction may be a development
                decision, a missed pawn break, or an exchange that changed the
                structure.
              </p>
              <p>
                For a practical baseline, read the five opening principles and
                the moments when they can be broken. Then test the ideas from a
                playable position instead of reciting moves from the starting
                board.
              </p>
            </div>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/blog/morphy-anderssen-kings-gambit-rook-invasion"
                className="inline-flex items-center gap-2 border border-cb-border-strong px-5 py-3 font-sans text-xs uppercase tracking-[0.12em]"
              >
                Study the King&apos;s Gambit <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/try"
                className="inline-flex items-center gap-2 bg-cb-accent px-5 py-3 font-sans text-xs uppercase tracking-[0.12em] text-cb-accent-fg"
              >
                Try a position <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </section>
        </article>
      </main>
      <Footer />
    </div>
  );
}
