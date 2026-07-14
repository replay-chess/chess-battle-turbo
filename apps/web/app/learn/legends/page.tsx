import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Navbar } from "@/app/components/Navbar";
import { Footer } from "@/app/components/Footer";
import { BASE_URL, createMetadata, safeJsonLd } from "@/lib/seo";

export const metadata: Metadata = createMetadata({
  title: "Learn Chess Through Famous Players and Games",
  description:
    "Use games by Anderssen, Fischer, and other great players to study development, attack, endgame technique, calculation, and the connection between moves and plans.",
  path: "/learn/legends",
});

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Learn Chess Through Famous Players and Games",
  description: metadata.description,
  url: `${BASE_URL}/learn/legends`,
  mainEntityOfPage: `${BASE_URL}/learn/legends`,
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

export default function LegendsGuidePage() {
  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar breadcrumbLabel="Chess Legends Guide" />
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
              Learn chess through famous players and games
            </h1>
            <p className="mt-6 max-w-3xl font-sans text-lg leading-8 text-cb-text-muted">
              Great games are useful when you stop treating them as
              performances. Pause before the critical decisions, build a
              candidate list, and ask what the position demanded before learning
              what the master played.
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
              Study decisions, not reputations
            </h2>
            <div className="mt-5 space-y-5 font-sans text-base leading-8 text-cb-text-muted">
              <p>
                A player’s reputation can hide the actual lesson. Anderssen is
                remembered for sacrifice, but his successful attacks were
                supplied by development, open lines, and pieces arriving with
                tempo. Fischer is remembered for precision, yet much of his
                endgame strength came from repeatable habits: active pieces, a
                working king, fixed weaknesses, and careful control of
                counterplay.
              </p>
              <p>
                Begin each game without the label. Ask who has more space, which
                king is less safe, where the pawn breaks are, and which piece is
                not participating. Only then compare your answer with the move
                played. This makes the historical game relevant to positions you
                will actually reach.
              </p>
            </div>
          </section>

          <section className="mt-14 border-t border-cb-border pt-12">
            <h2 className="font-serif text-4xl">Use contrasting model games</h2>
            <div className="mt-5 space-y-5 font-sans text-base leading-8 text-cb-text-muted">
              <p>
                Pair games with different kinds of decisions. A direct attacking
                game teaches local force, development, and calculation. A
                technical ending teaches improvement, restriction, and the value
                of small irreversible changes. A positional squeeze teaches how
                a favorable structure can limit an opponent before tactics
                appear.
              </p>
              <p>
                Morphy’s game against Anderssen is a useful attacking model
                because the final rook invasion did not appear from nowhere. The
                earlier pawn hooks, development choices, and missed defensive
                tempi explain why the king hunt became forcing.
              </p>
            </div>
            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              <Link
                href="/blog/morphy-anderssen-kings-gambit-rook-invasion"
                className="border border-cb-border p-5 font-serif text-xl transition-colors hover:border-cb-border-strong"
              >
                Study Morphy’s king hunt
              </Link>
              <Link
                href="/blog"
                className="border border-cb-border p-5 font-serif text-xl transition-colors hover:border-cb-border-strong"
              >
                Browse detailed analyses
              </Link>
            </div>
          </section>

          <section className="mt-14 border-t border-cb-border pt-12">
            <h2 className="font-serif text-4xl">A repeatable study session</h2>
            <div className="mt-5 space-y-5 font-sans text-base leading-8 text-cb-text-muted">
              <p>
                First, play through quickly to understand the story of the game.
                Second, return to three turning points and hide the next move.
                Write two or three candidates, calculate the opponent’s most
                forcing reply, and choose. Third, compare your plan with the
                game and explain the difference in one sentence.
              </p>
              <p>
                Finish by extracting a rule you can test: develop with threats
                when the enemy king is uncastled; improve rook activity before
                collecting pawns; prepare the pawn break that changes the
                structure. A small rule connected to a real position is more
                useful than remembering a long sequence without its purpose.
              </p>
            </div>
            <Link
              href="/try"
              className="mt-8 inline-flex items-center gap-2 bg-cb-accent px-5 py-3 font-sans text-xs uppercase tracking-[0.12em] text-cb-accent-fg"
            >
              Practice from a critical position{" "}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </section>
        </article>
      </main>
      <Footer />
    </div>
  );
}
