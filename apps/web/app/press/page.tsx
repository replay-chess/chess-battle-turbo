import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BASE_URL, createMetadata, safeJsonLd } from "@/lib/seo";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";
import { CopyButton } from "./CopyButton";

export const metadata: Metadata = createMetadata({
  title: "Press Kit",
  description:
    "Logos, boilerplate, facts and the trailer for ReplayChess — the open-source chess platform where you play the critical position from famous games.",
  path: "/press",
});

// Single source of truth for what directories, journalists and partners paste.
// Keep these in sync with /about, the README and directory listings.
const FACTS = [
  { label: "Name", value: "ReplayChess" },
  { label: "Website", value: BASE_URL },
  { label: "Try without an account", value: `${BASE_URL}/try` },
  { label: "Founded", value: "2026" },
  { label: "Founder", value: "Rohit Pandit" },
  { label: "Source", value: "Open source, MIT — github.com/replay-chess/chess-battle-turbo" },
  { label: "Catalogue", value: "50+ chess legends · 3,600+ ECO-coded openings" },
  { label: "Pricing", value: "Free · Player plan $4.99/month or $50/year" },
  { label: "Press contact", value: "hello@playchess.tech" },
];

const BOILERPLATE = {
  tagline: "Play the critical position from famous chess games.",
  short:
    "ReplayChess lets you pick a legendary game, start from its critical position, and try to find the moves the grandmaster found — against a friend, a matched opponent, or Stockfish in your browser. Then see exactly where you diverged.",
  long: "ReplayChess turns chess history into something you play, not watch. Choose a legend — Morphy, Fischer, Kasparov, Carlsen — jump into a famous game at its decisive moment, and play it out against a friend, a matched opponent, or Stockfish running in your browser. Post-game analysis shows your match rate against the original moves and the exact move where you left the legend's line. There is also an openings encyclopedia of 3,600+ ECO-coded positions to play from, ELO matchmaking, private challenge links, tournaments, and a PWA that installs on phone and desktop. Free to play; a $4.99/month Player plan unlocks the full catalogue. Open source under MIT.",
};

const ASSETS = [
  {
    name: "Logo (dark, PNG)",
    path: "/chess-logo-bnw.png",
    note: "Square knight mark on black. Use on any background.",
    preview: true,
  },
  {
    name: "App icon 512×512",
    path: "/icons/icon-512x512.png",
    note: "PWA icon. Also available at 384, 192, 144, 128, 96, 72, 48, 32 and 16 px under /icons/.",
    preview: true,
  },
  {
    name: "Social image 1200×630",
    path: "/og-image.jpg",
    note: "Open Graph / Twitter card image.",
    preview: true,
  },
  {
    name: "Trailer (MP4)",
    path: "/ReplayChessTrailer.mp4",
    note: "Product trailer, landscape. ~8 MB.",
    preview: false,
  },
  {
    name: "King's Gambit board animation (MP4)",
    path: "/Kings_Gambit_Chess_Board_Animation.mp4",
    note: "Short board-only clip for B-roll. ~3 MB.",
    preview: false,
  },
];

export default function PressPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${BASE_URL}/press`,
    url: `${BASE_URL}/press`,
    name: "ReplayChess Press Kit",
    about: { "@id": `${BASE_URL}/#organization` },
    isPartOf: { "@type": "WebSite", "@id": `${BASE_URL}/#website`, url: BASE_URL, name: "ReplayChess" },
  };

  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />

      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 sm:pt-36 pb-24">
        {/* Header */}
        <div className="mb-16">
          <div className="flex items-center gap-4 mb-6">
            <div className="h-px w-12 bg-cb-border-strong" />
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted text-[10px] tracking-[0.4em] uppercase"
            >
              Press kit
            </span>
          </div>
          <h1
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="text-5xl sm:text-6xl text-cb-text mb-4"
          >
            ReplayChess in one place
          </h1>
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-base text-cb-text-muted max-w-2xl leading-relaxed"
          >
            Everything you need to write about or list ReplayChess: facts, boilerplate you can
            paste, logos, and the trailer. Nothing here needs permission — use it as is, and
            link to <span className="text-cb-text-secondary">www.playchess.tech</span>.
          </p>
        </div>

        {/* Facts */}
        <Section title="Facts">
          <dl className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-x-6 gap-y-3 border border-cb-border p-6 bg-cb-hover">
            {FACTS.map((fact) => (
              <div key={fact.label} className="contents">
                <dt
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[11px] uppercase tracking-[0.15em] text-cb-text-muted pt-0.5"
                >
                  {fact.label}
                </dt>
                <dd
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-sm text-cb-text-secondary break-words m-0"
                >
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        {/* Boilerplate */}
        <Section title="Boilerplate">
          <div className="space-y-px bg-cb-hover">
            {(
              [
                ["Tagline", BOILERPLATE.tagline],
                ["Short (one paragraph)", BOILERPLATE.short],
                ["Long", BOILERPLATE.long],
              ] as const
            ).map(([label, text]) => (
              <div key={label} className="bg-cb-bg border border-cb-border p-6">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <h3
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-[11px] uppercase tracking-[0.15em] text-cb-text-muted"
                  >
                    {label}{" "}
                    <span className="text-cb-text-faint normal-case tracking-normal">
                      · {text.length} chars
                    </span>
                  </h3>
                  <CopyButton text={text} />
                </div>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-sm text-cb-text-secondary leading-relaxed"
                >
                  {text}
                </p>
              </div>
            ))}
          </div>
        </Section>

        {/* Assets */}
        <Section title="Logos and media">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-cb-hover">
            {ASSETS.map((asset) => (
              <a
                key={asset.path}
                href={asset.path}
                download
                className="group bg-cb-bg border border-cb-border p-5 hover:bg-cb-hover transition-colors"
              >
                {asset.preview && (
                  <div className="relative aspect-[1200/630] mb-4 bg-black overflow-hidden">
                    <Image
                      src={asset.path}
                      alt={asset.name}
                      fill
                      sizes="(max-width: 640px) 100vw, 400px"
                      className="object-contain"
                    />
                  </div>
                )}
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-sm text-cb-text group-hover:text-cb-text-secondary transition-colors"
                >
                  {asset.name}
                </p>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[11px] text-cb-text-faint mt-1"
                >
                  {asset.note}
                </p>
                <p
                  style={{ fontFamily: "'Geist Mono', monospace" }}
                  className="text-[11px] text-cb-text-muted mt-2 break-all"
                >
                  {BASE_URL}
                  {asset.path}
                </p>
              </a>
            ))}
          </div>
        </Section>

        {/* Founder */}
        <Section title="Founder">
          <div className="flex items-start gap-5 border border-cb-border p-6 bg-cb-hover">
            <Image
              src="/rohit-pandit.jpeg"
              alt="Rohit Pandit"
              width={72}
              height={72}
              className="rounded-full object-cover grayscale shrink-0"
            />
            <div>
              <p
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-2xl text-cb-text"
              >
                Rohit Pandit
              </p>
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-sm text-cb-text-muted leading-relaxed mt-2 max-w-xl"
              >
                Builds ReplayChess solo, in public. Available for interviews, podcasts and
                written Q&amp;A about chess software, real-time multiplayer on the web, and
                running an open-source product as one person.
              </p>
              <div
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs text-cb-text-secondary"
              >
                <a href="https://x.com/anaestheticdev" target="_blank" rel="noopener noreferrer" className="hover:text-cb-text">
                  x.com/anaestheticdev
                </a>
                <a href="mailto:hello@playchess.tech" className="hover:text-cb-text">
                  hello@playchess.tech
                </a>
                <Link href="/blog/author/rohit-pandit" className="hover:text-cb-text">
                  Articles
                </Link>
              </div>
            </div>
          </div>
        </Section>

        {/* What to link */}
        <Section title="Good pages to link">
          <ul
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-sm text-cb-text-secondary space-y-2"
          >
            {(
              [
                ["/try", "Play a famous position without an account"],
                ["/legends", "Chess legends catalogue"],
                ["/openings", "Openings encyclopedia (ECO A–E)"],
                ["/blog", "Annotated games and platform updates"],
                ["/pricing", "Plans"],
              ] as const
            ).map(([path, label]) => (
              <li key={path} className="flex flex-wrap gap-x-3">
                <Link href={path} className="text-cb-text hover:text-cb-text-secondary underline underline-offset-4 decoration-cb-border-strong">
                  {BASE_URL}
                  {path}
                </Link>
                <span className="text-cb-text-muted">{label}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Footer />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-14">
      <h2
        style={{ fontFamily: "'Geist', sans-serif" }}
        className="text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary mb-5"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}
