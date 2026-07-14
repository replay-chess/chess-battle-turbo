import Link from "next/link";
import { Crown } from "lucide-react";
import { Navbar } from "@/app/components/Navbar";
import { Footer } from "@/app/components/Footer";
import { TryPositions } from "@/app/try/TryPositions";
import { getFeaturedPositions } from "@/lib/featured-positions";
import { BASE_URL, safeJsonLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

const tryJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "ReplayChess Position Challenges",
  url: `${BASE_URL}/try`,
  description:
    "Play curated positions from famous chess games against the engine without creating an account.",
  applicationCategory: "GameApplication",
  operatingSystem: "Any",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

export default async function TryPage() {
  const positions = await getFeaturedPositions().catch(() => []);

  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(tryJsonLd) }}
      />
      <main>
        <header className="px-6 pb-12 pt-32 text-center sm:pb-16 sm:pt-40">
          <div className="inline-flex items-center gap-2 border border-cb-border bg-cb-hover px-4 py-1.5">
            <Crown className="h-3 w-3 text-cb-text-muted" />
            <span className="font-sans text-[10px] uppercase tracking-[0.3em] text-cb-text-secondary">
              No account required
            </span>
          </div>
          <h1 className="mt-6 font-serif text-5xl leading-tight sm:text-6xl md:text-7xl">
            Play legendary chess positions free
          </h1>
          <p className="mx-auto mt-5 max-w-2xl font-sans text-base leading-7 text-cb-text-muted sm:text-lg">
            Step into a critical moment from chess history, find the plan, and
            test your calculation against the engine. Choose a board below to
            begin.
          </p>
        </header>

        <section
          className="px-4 pb-16 sm:px-8"
          aria-labelledby="featured-positions"
        >
          <div className="mx-auto max-w-6xl">
            <h2 id="featured-positions" className="sr-only">
              Featured chess positions
            </h2>
            <TryPositions positions={positions} />
          </div>
        </section>

        <section className="border-t border-cb-border px-6 py-16 sm:py-24">
          <div className="mx-auto max-w-5xl">
            <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-cb-text-muted">
              How to use a position challenge
            </p>
            <h2 className="mt-4 max-w-3xl font-serif text-4xl leading-tight sm:text-5xl">
              Train the decision, not just the move
            </h2>
            <div className="mt-10 grid gap-8 md:grid-cols-3">
              <article>
                <p className="font-mono text-xs text-cb-text-faint">01</p>
                <h3 className="mt-3 font-serif text-2xl">Read the position</h3>
                <p className="mt-3 font-sans text-sm leading-7 text-cb-text-muted">
                  Before moving, identify king safety, loose pieces, pawn
                  breaks, forcing moves, and which side benefits from waiting.
                </p>
              </article>
              <article>
                <p className="font-mono text-xs text-cb-text-faint">02</p>
                <h3 className="mt-3 font-serif text-2xl">Choose a plan</h3>
                <p className="mt-3 font-sans text-sm leading-7 text-cb-text-muted">
                  Form a short candidate list. Compare checks and captures with
                  the quiet move that improves your least useful piece.
                </p>
              </article>
              <article>
                <p className="font-mono text-xs text-cb-text-faint">03</p>
                <h3 className="mt-3 font-serif text-2xl">Review the result</h3>
                <p className="mt-3 font-sans text-sm leading-7 text-cb-text-muted">
                  After the game, return to the first decision and explain why
                  the strongest plan worked. That explanation is the reusable
                  lesson.
                </p>
              </article>
            </div>

            <div className="mt-14 flex flex-wrap gap-5 border-t border-cb-border pt-8 font-sans text-sm">
              <Link
                href="/learn/openings"
                className="underline decoration-cb-border-strong underline-offset-4"
              >
                Learn opening plans
              </Link>
              <Link
                href="/learn/legends"
                className="underline decoration-cb-border-strong underline-offset-4"
              >
                Study famous players
              </Link>
              <Link
                href="/blog"
                className="underline decoration-cb-border-strong underline-offset-4"
              >
                Read practical chess lessons
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
