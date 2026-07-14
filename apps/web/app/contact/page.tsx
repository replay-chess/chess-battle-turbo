import Link from "next/link";
import { ArrowRight, Mail, MessageCircle } from "lucide-react";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";

const contactReasons = [
  {
    title: "Product and technical support",
    text: "Include the affected page, your browser and device, and enough detail to reproduce the problem.",
    subject: "ReplayChess support request",
  },
  {
    title: "Chess content corrections",
    text: "Send the page URL, the correction, and a reliable game record or source when possible.",
    subject: "ReplayChess content correction",
  },
  {
    title: "Partnerships and press",
    text: "Explain who you are, what you would like to build together, and any relevant timeline.",
    subject: "ReplayChess partnership inquiry",
  },
];

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar />
      <main>
        <header className="border-b border-cb-border px-6 pb-16 pt-32 text-center sm:pt-40">
          <p className="font-sans text-[10px] uppercase tracking-[0.35em] text-cb-text-muted">
            Contact ReplayChess
          </p>
          <h1 className="mx-auto mt-5 max-w-4xl font-serif text-5xl leading-tight sm:text-6xl md:text-7xl">
            Contact ReplayChess support and partnerships
          </h1>
          <p className="mx-auto mt-6 max-w-2xl font-sans text-base leading-7 text-cb-text-muted sm:text-lg">
            ReplayChess is built by Rohit Pandit. Use the verified email address
            below for support, corrections, partnerships, or thoughtful
            feedback.
          </p>
          <a
            href="mailto:hello@playchess.tech"
            className="mt-8 inline-flex items-center gap-2 bg-cb-accent px-7 py-3 font-sans text-xs uppercase tracking-[0.12em] text-cb-accent-fg"
          >
            <Mail className="h-4 w-4" /> hello@playchess.tech
          </a>
        </header>

        <section
          className="px-6 py-16 sm:py-24"
          aria-labelledby="contact-reasons"
        >
          <div className="mx-auto max-w-6xl">
            <h2
              id="contact-reasons"
              className="font-serif text-3xl sm:text-4xl"
            >
              What to include
            </h2>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {contactReasons.map((reason) => (
                <article
                  key={reason.title}
                  className="border border-cb-border p-6"
                >
                  <h3 className="font-serif text-2xl">{reason.title}</h3>
                  <p className="mt-3 font-sans text-sm leading-6 text-cb-text-muted">
                    {reason.text}
                  </p>
                  <a
                    href={`mailto:hello@playchess.tech?subject=${encodeURIComponent(reason.subject)}`}
                    className="mt-7 inline-flex items-center gap-2 font-sans text-xs uppercase tracking-[0.12em] text-cb-text-secondary"
                  >
                    Compose email <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-cb-border px-6 py-16 text-center">
          <MessageCircle className="mx-auto h-5 w-5 text-cb-text-muted" />
          <h2 className="mt-5 font-serif text-3xl">
            Follow the build in public
          </h2>
          <p className="mx-auto mt-3 max-w-xl font-sans text-sm leading-6 text-cb-text-muted">
            For product updates and chess notes, follow Rohit on X or browse the
            ReplayChess journal.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-5 font-sans text-sm">
            <a
              href="https://x.com/anaestheticdev"
              target="_blank"
              rel="me noopener noreferrer"
              className="underline decoration-cb-border-strong underline-offset-4"
            >
              @anaestheticdev
            </a>
            <Link
              href="/blog"
              className="underline decoration-cb-border-strong underline-offset-4"
            >
              Read the journal
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
