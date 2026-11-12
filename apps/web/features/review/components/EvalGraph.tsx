"use client";

// EvalGraph (plan §4.1; V3ReviewSummary): a 540 × 72 SVG of the viewer's Win% (their side up, P3-Q8), the midline,
// the filled area, ticks for the viewer's inaccuracies, mistakes, misses, blunders and brilliant moves, and a dashed
// line at the current ply. One invisible button per ply in a `role="group"` "Jump to a move"; plies not graded yet
// are disabled. Long games are downsampled to 240 points (model.graphOf).

import { COPY, QUALITY_LABEL } from "../copy";
import { useReview, useView } from "../context";
import { GRAPH_H, GRAPH_W, graphOf, graphX, judgementAt, moveText } from "../model";
import { bucket10, trackReview } from "../telemetry";

const TICK_COLOR: Record<string, string> = {
  inaccuracy: "var(--mq-inaccuracy)",
  mistake: "var(--mq-mistake)",
  miss: "var(--mq-miss)",
  blunder: "var(--mq-blunder)",
  brilliant: "var(--mq-brilliant)",
};

export function EvalGraph({ compact = false }: { compact?: boolean }) {
  const { dto, plies } = useReview();
  const ply = useView((v) => v.ply);
  const setPly = useView((v) => v.setPly);
  const mode = useView((v) => v.mode);
  const a = dto.analysis;
  if (!a) return null;
  const total = a.totalPlies || plies.san.length;
  const g = graphOf({ ...a, totalPlies: total }, plies, dto.you);
  const curX = graphX(ply + 1, total);
  const jump = (i: number) => {
    setPly(i);
    trackReview("eval_graph_jump", { ply_bucket: bucket10(i) });
  };
  return (
    <div className="rv-graph" data-testid="eval-graph">
      <div className="rv-graph__box">
        <svg viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`} preserveAspectRatio="none" role="img" aria-label={COPY.graphLabel}>
          <line className="rv-graph__mid" x1="0" y1={GRAPH_H / 2} x2={GRAPH_W} y2={GRAPH_H / 2} strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {g.area ? <polygon className="rv-graph__area" points={g.area} /> : null}
          {g.line ? (
            <polyline className="rv-graph__line" points={g.line} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          ) : null}
          {g.ticks.map((t) => (
            <line
              key={t.ply}
              x1={t.x}
              y1="0"
              x2={t.x}
              y2={GRAPH_H}
              stroke={TICK_COLOR[t.key]}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              data-tick={t.key}
            />
          ))}
          {mode === "moves" && ply >= 0 ? (
            <line
              className="rv-graph__cur"
              x1={curX}
              y1="0"
              x2={curX}
              y2={GRAPH_H}
              strokeWidth="1"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
        <div className="rv-graph__btns" role="group" aria-label={COPY.graphGroup}>
          {plies.san.map((_, i) => {
            const key = judgementAt(a, i);
            const aria = `Jump to ${moveText(plies, i)}${key ? `, ${QUALITY_LABEL[key]}` : ""}`;
            return (
              <button
                key={i}
                type="button"
                tabIndex={i === Math.max(0, ply) ? 0 : -1}
                disabled={i >= a.gradedPlies}
                aria-label={aria}
                title={aria}
                aria-current={i === ply && mode === "moves" ? "true" : undefined}
                onClick={() => jump(i)}
                onKeyDown={(e) => {
                  // A roving group: arrows move focus along the graded plies, Enter/Space jump (the button's own).
                  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
                  e.preventDefault();
                  const last = Math.max(0, a.gradedPlies - 1);
                  const to =
                    e.key === "Home" ? 0 : e.key === "End" ? last : Math.min(last, Math.max(0, i + (e.key === "ArrowLeft" ? -1 : 1)));
                  const group = e.currentTarget.parentElement;
                  (group?.children[to] as HTMLButtonElement | undefined)?.focus();
                  jump(to);
                }}
              />
            );
          })}
        </div>
      </div>
      <div className="rv-graph__axis rv-mono">
        <span>{COPY.graphStart}</span>
        {compact ? null : <span className="rv-tall">{COPY.graphHint}</span>}
        <span>{COPY.graphEnd}</span>
      </div>
    </div>
  );
}
