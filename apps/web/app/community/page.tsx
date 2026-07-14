import Link from "next/link";
import { ArrowRight, BookOpen, MessageCircle, Swords } from "lucide-react";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";

const channels = [
  {
    title: "Follow the build",
    description:
      "Rohit shares product notes, chess ideas, and ReplayChess progress on X.",
    href: "https://x.com/anaestheticdev",
    label: "Follow on X",
    external: true,
    icon: MessageCircle,
  },
  {
    title: "Read the journal",
    description:
      "Study practical chess strategy, opening ideas, and lessons from famous games.",
    href: "/blog",
    label: "Browse articles",
    external: false,
    icon: BookOpen,
  },
  {
    title: "Try a position",
    description:
      "Play a curated position against the engine without creating an account.",
    href: "/try",
    label: "Start a challenge",
    external: false,
    icon: Swords,
  },
];

export default function CommunityPage() {
  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar />
      <main>
        <header className="border-b border-cb-border px-6 pb-16 pt-32 text-center sm:pt-40">
          <p className="font-sans text-[10px] uppercase tracking-[0.35em] text-cb-text-muted">
            Community
          </p>
          <h1 className="mx-auto mt-5 max-w-4xl font-serif text-5xl leading-tight sm:text-6xl md:text-7xl">
            Follow ReplayChess as it grows
          </h1>
          <p className="mx-auto mt-6 max-w-2xl font-sans text-base leading-7 text-cb-text-muted sm:text-lg">
            ReplayChess does not operate a public Discord, leaderboard, or event
            calendar yet. These are the official places to learn, play, and send
            feedback today.
          </p>
        </header>

        <section
          className="px-6 py-16 sm:py-24"
          aria-labelledby="official-channels"
        >
          <div className="mx-auto max-w-6xl">
            <h2
              id="official-channels"
              className="font-serif text-3xl sm:text-4xl"
            >
              Official channels
            </h2>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {channels.map((channel) => {
                const Icon = channel.icon;
                const className =
                  "group flex h-full flex-col border border-cb-border bg-cb-surface p-6 transition-colors hover:border-cb-border-strong";
                const content = (
                  <>
                    <Icon
                      className="h-5 w-5 text-cb-text-muted"
                      aria-hidden="true"
                    />
                    <h3 className="mt-8 font-serif text-2xl">
                      {channel.title}
                    </h3>
                    <p className="mt-3 flex-1 font-sans text-sm leading-6 text-cb-text-muted">
                      {channel.description}
                    </p>
                    <span className="mt-7 inline-flex items-center gap-2 font-sans text-xs uppercase tracking-[0.12em] text-cb-text-secondary">
                      {channel.label}
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                    </span>
                  </>
                );

                return channel.external ? (
                  <a
                    key={channel.title}
                    href={channel.href}
                    target="_blank"
                    rel="me noopener noreferrer"
                    className={className}
                  >
                    {content}
                  </a>
                ) : (
                  <Link
                    key={channel.title}
                    href={channel.href}
                    className={className}
                  >
                    {content}
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
