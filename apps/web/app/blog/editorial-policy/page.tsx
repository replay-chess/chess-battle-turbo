import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/app/components/Navbar";
import { Footer } from "@/app/components/Footer";
import { createMetadata } from "@/lib/seo";

export const metadata: Metadata = createMetadata({
  title: "ReplayChess Editorial and Corrections Policy",
  description:
    "Learn how ReplayChess selects chess topics, checks historical and instructional claims, credits sources, handles AI assistance, and corrects published articles.",
  path: "/blog/editorial-policy",
});

export default function EditorialPolicyPage() {
  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar breadcrumbLabel="Editorial Policy" />
      <main>
        <header className="border-b border-cb-border px-6 pb-16 pt-32 sm:pt-40">
          <div className="mx-auto max-w-4xl">
            <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-cb-text-muted">
              Publishing standards
            </p>
            <h1 className="mt-5 font-serif text-5xl leading-tight sm:text-6xl">
              ReplayChess editorial and corrections policy
            </h1>
            <p className="mt-6 max-w-3xl font-sans text-lg leading-8 text-cb-text-muted">
              ReplayChess publishes chess instruction for people who want to
              understand positions. Accuracy, clear sourcing, and useful
              explanation matter more than publishing quickly.
            </p>
          </div>
        </header>

        <article className="mx-auto max-w-3xl space-y-12 px-6 py-16 font-sans text-base leading-8 text-cb-text-muted sm:py-24">
          <section>
            <h2 className="font-serif text-4xl text-cb-text">
              Who writes the articles
            </h2>
            <p className="mt-5">
              Articles are written and reviewed by{" "}
              <Link
                href="/blog/author/rohit-pandit"
                className="text-cb-text-secondary underline decoration-cb-border-strong underline-offset-4"
              >
                Rohit Pandit
              </Link>
              , the maker of ReplayChess. Author information appears on every
              published article.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-4xl text-cb-text">
              How claims are checked
            </h2>
            <p className="mt-5">
              Historical game claims are checked against available game records.
              Instructional claims are evaluated against the complete position,
              not isolated engine scores. When an article depends on a
              particular game record or outside reference, that source is linked
              in the article.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-4xl text-cb-text">AI assistance</h2>
            <p className="mt-5">
              Tools may assist with outlining, editing, or checking clarity.
              They do not replace human responsibility for the published
              analysis. Drafts with unverified product, event, or historical
              claims remain unpublished until those claims can be confirmed.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-4xl text-cb-text">Corrections</h2>
            <p className="mt-5">
              Material corrections are made in the article and reflected in its
              updated date. To report an error, email{" "}
              <a
                href="mailto:hello@playchess.tech?subject=ReplayChess%20content%20correction"
                className="text-cb-text-secondary underline decoration-cb-border-strong underline-offset-4"
              >
                hello@playchess.tech
              </a>{" "}
              with the page URL, the disputed detail, and a reliable source when
              possible.
            </p>
          </section>
        </article>
      </main>
      <Footer />
    </div>
  );
}
