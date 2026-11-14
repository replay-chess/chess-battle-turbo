"use client";

// "Where this position came from" (bank items while solving, §4.4): the game, the move played with its judgement,
// and the cost line ("Rxf5 won a bishop here, about +2.7 for you. Qd2 let it go.").
import type { TrainItemContext } from "@repo/contracts/http/train";

const JUDGEMENT: Record<TrainItemContext["judgement"], { label: string; tone: "warn" | "bad" }> = {
  inaccuracy: { label: "Inaccuracy", tone: "warn" },
  mistake: { label: "Mistake", tone: "warn" },
  miss: { label: "Miss", tone: "bad" },
  blunder: { label: "Blunder", tone: "bad" },
};

export function SourceCard({ context }: { context: TrainItemContext }) {
  const j = JUDGEMENT[context.judgement];
  return (
    <section className="tr-card" aria-label="Where this position came from" data-testid="trainer-source">
      <span className="tr-lbl">From your game</span>
      <span className="tr-card__title">{context.gameLabel}</span>
      <span className="tr-card__line">
        You played <span className="tr-mono">{context.playedSan}</span> ·{" "}
        <span style={{ color: j.tone === "bad" ? "var(--cb-bad)" : "var(--cb-warn)" }}>{j.label}</span>
      </span>
      <span className="tr-card__cost">{context.costText}</span>
    </section>
  );
}
