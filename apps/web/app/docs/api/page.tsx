import Link from "next/link";
import { ArrowRight, Code2, Mail } from "lucide-react";
import { Navbar } from "../../components/Navbar";
import { Footer } from "../../components/Footer";

export default function ApiDocsPage() {
  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar />
      <main>
        <header className="border-b border-cb-border px-6 pb-16 pt-32 text-center sm:pt-40">
          <Code2 className="mx-auto h-6 w-6 text-cb-text-muted" />
          <h1 className="mt-6 font-serif text-5xl sm:text-6xl md:text-7xl">
            ReplayChess API preview
          </h1>
          <p className="mx-auto mt-6 max-w-2xl font-sans text-base leading-7 text-cb-text-muted sm:text-lg">
            A public developer API is not available yet. This page does not
            claim that planned endpoints are live and does not collect
            notification emails.
          </p>
        </header>

        <section className="px-6 py-16 sm:py-24">
          <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-2">
            <div className="border border-cb-border p-7">
              <h2 className="font-serif text-3xl">
                Interested in future access?
              </h2>
              <p className="mt-4 font-sans text-sm leading-7 text-cb-text-muted">
                Describe the chess data or workflow you need. That context is
                more useful than an inactive mailing-list form.
              </p>
              <a
                href="mailto:hello@playchess.tech?subject=ReplayChess%20API%20interest"
                className="mt-7 inline-flex items-center gap-2 font-sans text-xs uppercase tracking-[0.12em] text-cb-text-secondary"
              >
                <Mail className="h-4 w-4" /> Contact the team
              </a>
            </div>
            <div className="border border-cb-border p-7">
              <h2 className="font-serif text-3xl">Use ReplayChess today</h2>
              <p className="mt-4 font-sans text-sm leading-7 text-cb-text-muted">
                The public journal and no-account position challenges are
                available now while developer access is being evaluated.
              </p>
              <Link
                href="/try"
                className="mt-7 inline-flex items-center gap-2 font-sans text-xs uppercase tracking-[0.12em] text-cb-text-secondary"
              >
                Try a position <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
