"use client";

// "Where this position came from" (bank items while solving, §4.4): the game, the move played with its judgement,
// and the cost line ("Rxf5 won a bishop here, about +2.7 for you. Qd2 let it go."). The cost line names the best move
// and its eval, so it waits for the member's first try (a move, or Show Solution): before that the card says the best
// move is hidden, as the bank list does (browser pass D2, for every card source: an own game or an imported one).
import type { TrainItemContext } from "@repo/contracts/http/train";

const JUDGEMENT: Record<TrainItemContext["judgement"], { label: string; tone: "warn" | "bad" }> = {
  inaccuracy: { label: "Inaccuracy", tone: "warn" },
  mistake: { label: "Mistake", tone: "warn" },
  miss: { label: "Miss", tone: "bad" },
  blunder: { label: "Blunder", tone: "bad" },
};

/** The line in place of the cost line until the member has tried (the bank list's wording). */
export const COST_HIDDEN = "Best move hidden until you try.";

export function SourceCard({ context, tried }: { context: TrainItemContext; tried: boolean }) {
  const j = JUDGEMENT[context.judgement];
  return (
    <section className="tr-card" aria-label="Where this position came from" data-testid="trainer-source">
      <span className="tr-lbl">From your game</span>
      <span className="tr-card__title">{context.gameLabel}</span>
      <span className="tr-card__line">
        You played <span className="tr-mono">{context.playedSan}</span> ·{" "}
        <span style={{ color: j.tone === "bad" ? "var(--cb-bad)" : "var(--cb-warn)" }}>{j.label}</span>
      </span>
      <span className="tr-card__cost" data-testid="trainer-source-cost">
        {tried ? context.costText : COST_HIDDEN}
      </span>
    </section>
  );
}
