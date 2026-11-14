"use client";

// "Due today · 4 positions" (bank runner, side mode, tall screens): DONE / NOW / NEXT per item, the current one
// `aria-current="step"`. Labels come from the payload's `queueLabels` ("tal_fan_77 · move 17 · Recapture first").
import type { SessionPayload, TrainItem } from "@repo/contracts/http/train";

const MAX_ROWS = 6;

export function QueueList({ items, labels, index, solvedCurrent }: { items: readonly TrainItem[]; labels: SessionPayload["queueLabels"]; index: number; solvedCurrent: boolean }) {
  const byId = new Map(labels.map((l) => [l.itemId, l.label] as const));
  const from = Math.max(0, Math.min(index - 1, items.length - MAX_ROWS));
  const rows = items.slice(from, from + MAX_ROWS).map((it, k) => {
    const i = k + from;
    const state = i < index || (i === index && solvedCurrent) ? "done" : i === index ? "now" : "next";
    return { id: it.itemId, label: byId.get(it.itemId) ?? byId.get(it.itemId.replace(/b$/, "")) ?? it.sourceLabel, state };
  });
  return (
    <section className="tr-queue tr-side-only tr-tall" aria-labelledby="tr-queue-h" data-testid="trainer-queue">
      <div className="tr-queue__head">
        <h2 id="tr-queue-h" className="tr-lbl" style={{ margin: 0 }}>
          Due today
        </h2>
        <span className="tr-mono" style={{ fontSize: "0.75rem", color: "var(--cb-text-soft)" }}>
          {items.length} {items.length === 1 ? "position" : "positions"}
        </span>
      </div>
      <ol>
        {rows.map((r) => (
          <li key={r.id} className="tr-qrow" data-s={r.state} aria-current={r.state === "now" ? "step" : undefined}>
            <span className="tr-qrow__dot" aria-hidden="true" />
            <span className="tr-qrow__name">{r.label}</span>
            <span className="tr-qrow__state tr-mono">{r.state === "done" ? "DONE" : r.state === "now" ? "NOW" : "NEXT"}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
