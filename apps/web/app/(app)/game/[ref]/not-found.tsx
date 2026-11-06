// A game that does not exist, or one the viewer may not see (plan 4.7): same answer, so existence is not leaked.
import Link from "next/link";

export default function GameNotFound() {
  return (
    <div
      style={{ minHeight: "60dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      data-testid="game-not-found"
    >
      <div style={{ maxWidth: 420, display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 className="font-serif text-3xl leading-tight text-cb-text">This game doesn’t exist</h1>
        <p className="text-sm text-cb-text-soft">It may have been cancelled, or the link is wrong.</p>
        <Link
          href="/play"
          className="inline-flex min-h-11 items-center justify-center self-start bg-cb-accent px-4 text-sm font-medium text-cb-accent-fg hover:bg-cb-accent-hover"
        >
          Back to Play
        </Link>
      </div>
    </div>
  );
}
