import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";
import { safeJsonLd } from "@/lib/seo";

const helpItems = [
  {
    question: "Can I try ReplayChess without creating an account?",
    answer:
      "Yes. Open the free position challenges, choose a featured position, and play against the engine. An account is only required for protected multiplayer and library features.",
    href: "/try",
    linkLabel: "Open free challenges",
  },
  {
    question:
      "Why am I asked to sign in for legends, openings, or multiplayer?",
    answer:
      "The complete interactive libraries and multiplayer tools are account features. Public learning guides and the journal remain available without signing in.",
    href: "/learn/legends",
    linkLabel: "Read the public learning guides",
  },
  {
    question: "Where can I manage or cancel a subscription?",
    answer:
      "Signed-in subscribers can open the account menu and choose Manage Billing. Access continues according to the billing terms shown when the subscription was purchased.",
    href: "/pricing",
    linkLabel: "Review plans and billing FAQs",
  },
  {
    question: "How do I report an incorrect chess position or article detail?",
    answer:
      "Email the ReplayChess team with the page URL, the detail that appears incorrect, and a reliable source when possible. Corrections are reviewed before publication.",
    href: "mailto:hello@playchess.tech?subject=ReplayChess%20content%20correction",
    linkLabel: "Email a correction",
  },
  {
    question: "What should I include when reporting a technical issue?",
    answer:
      "Include the page URL, device and browser, what you expected to happen, what happened instead, and a screenshot if it does not contain private information.",
    href: "mailto:hello@playchess.tech?subject=ReplayChess%20technical%20issue",
    linkLabel: "Email technical support",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: helpItems.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  })),
};

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(faqJsonLd) }}
      />
      <main>
        <header className="border-b border-cb-border px-6 pb-16 pt-32 text-center sm:pt-40">
          <p className="font-sans text-[10px] uppercase tracking-[0.35em] text-cb-text-muted">
            ReplayChess help
          </p>
          <h1 className="mt-5 font-serif text-5xl sm:text-6xl md:text-7xl">
            Games, accounts and billing help
          </h1>
          <p className="mx-auto mt-6 max-w-2xl font-sans text-base leading-7 text-cb-text-muted sm:text-lg">
            Straight answers for the most common ReplayChess questions, plus a
            direct way to reach the team when something needs attention.
          </p>
        </header>

        <section className="px-6 py-16 sm:py-24" aria-labelledby="help-answers">
          <div className="mx-auto max-w-4xl">
            <h2 id="help-answers" className="sr-only">
              Help answers
            </h2>
            <div className="divide-y divide-cb-border border-y border-cb-border">
              {helpItems.map((item) => (
                <article
                  key={item.question}
                  className="py-8 sm:grid sm:grid-cols-12 sm:gap-8"
                >
                  <h3 className="font-serif text-2xl leading-tight sm:col-span-5">
                    {item.question}
                  </h3>
                  <div className="mt-4 sm:col-span-7 sm:mt-0">
                    <p className="font-sans text-sm leading-7 text-cb-text-muted">
                      {item.answer}
                    </p>
                    {item.href.startsWith("mailto:") ? (
                      <a
                        href={item.href}
                        className="mt-4 inline-flex items-center gap-2 font-sans text-xs uppercase tracking-[0.12em] text-cb-text-secondary underline decoration-cb-border-strong underline-offset-4"
                      >
                        {item.linkLabel} <ArrowRight className="h-3.5 w-3.5" />
                      </a>
                    ) : (
                      <Link
                        href={item.href}
                        className="mt-4 inline-flex items-center gap-2 font-sans text-xs uppercase tracking-[0.12em] text-cb-text-secondary underline decoration-cb-border-strong underline-offset-4"
                      >
                        {item.linkLabel} <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-cb-border px-6 py-16 text-center">
          <Mail
            className="mx-auto h-5 w-5 text-cb-text-muted"
            aria-hidden="true"
          />
          <h2 className="mt-5 font-serif text-3xl">Still need help?</h2>
          <p className="mx-auto mt-3 max-w-xl font-sans text-sm leading-6 text-cb-text-muted">
            Email the team directly. ReplayChess does not use an automated
            support form that pretends a message was sent.
          </p>
          <a
            href="mailto:hello@playchess.tech"
            className="mt-6 inline-flex border border-cb-border-strong bg-cb-accent px-6 py-3 font-sans text-xs uppercase tracking-[0.12em] text-cb-accent-fg"
          >
            hello@playchess.tech
          </a>
        </section>
      </main>
      <Footer />
    </div>
  );
}
