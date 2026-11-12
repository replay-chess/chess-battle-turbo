"use client";

// The P3 parts of P2's game-over card (phase-03 plan §4.7, §5.8; P3-D29; boards V3GameOverLegend and the V3Game
// over_* states, incl. over_analysing). Loaded lazily (lazy.tsx): /game/[ref] is at its 600 kB budget, so nothing here
// is in the route's first load. Mounted only with `review-v3` on.
//
//   ReviewPrimary        the CTA: disabled "Analysing · 64%" (spinner) → See What the Coach Thinks; Open Review when
//                        the analysis failed (or never ran); nothing for skipped games. It DRIVES useAnalysisProgress.
//   ReviewAccuracySlot   "Accuracy 91 · 1 moment to learn from" (final numbers only), the progress bar while analysing,
//                        "Review paused · retrying" after a failure.
//   ReviewCoachSlot      the one-sentence coach line (≤ 160 chars, aria-live polite). No VERIFIED tag: template text
//                        is not verifier output (P3-D16; P7 adds the tag with READY text).
//   ReviewLegendSlot     `over_legend`: the matched sentence, the outcome line, the move table (✓ / ×), Replay from Move
//                        N (→ /practice) and Compare with {Legend} (→ /review/<ref>/legend).
// Every slot reads the game from the card's context and renders nothing for spectators, aborted games or skipped
// analyses; an empty slot wrapper collapses (lazy.css).

import Link from "next/link";
import type { LegendSummaryDTO } from "@repo/contracts/http/review";
import { useController, useGame, useView } from "@/features/game/screen/GameContext";
import { gameOverReviewPath } from "../paths";
import { bucket10, trackReview } from "../telemetry";
import {
  GAME_OVER_COPY,
  GAME_OVER_FRESH_MS,
  gameOverModel,
  legendLine,
  replayLink,
  type GameOverModel,
} from "./model";
import { useAnalysisProgress } from "./useAnalysisProgress";
import "./game-over-review.css";

type GameFacts = { ref: string; plies: number; fresh: boolean; legend: boolean; demo: boolean };

/** The one export lazy.tsx loads: a slot or the primary by name (one dynamic stub on the eager side). */
export function ReviewPart({ part }: { part: "primary" | "accuracy" | "coach" | "legend" }) {
  switch (part) {
    case "primary":
      return <ReviewPrimary />;
    case "accuracy":
      return <ReviewAccuracySlot />;
    case "coach":
      return <ReviewCoachSlot />;
    case "legend":
      return <ReviewLegendSlot />;
  }
}

/** The card's game, or null when the review slots do not apply (spectator, aborted, not over). */
function useGameFacts(): GameFacts | null {
  const controller = useController();
  const view = useView();
  const ref = useGame((g) => g.state.ref);
  const endedAt = useGame((g) => g.state.result?.endedAt ?? null);
  const position = useGame((g) => g.state.position !== null);
  const r = view.result;
  if (!r || r.spectator || r.method === "aborted") return null;
  const fresh = endedAt !== null && controller.serverNow() - endedAt < GAME_OVER_FRESH_MS;
  return { ref, plies: r.ply, fresh, legend: position, demo: controller.kind === "demo" };
}

function useModel(facts: GameFacts, drive: boolean): GameOverModel {
  const status = useAnalysisProgress(facts.ref, {
    target: "status",
    drive,
    plies: facts.plies,
    fresh: facts.fresh,
    legend: facts.legend,
    demo: facts.demo,
  });
  return gameOverModel({ status, plies: facts.plies, fresh: facts.fresh });
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function ReviewPrimary() {
  const facts = useGameFacts();
  if (!facts) return null;
  return <Primary facts={facts} />;
}

function Primary({ facts }: { facts: GameFacts }) {
  const m = useModel(facts, true);
  const p = m.primary;
  // One polite live region for the card: "Analysis ready" with the headline and the coach line when it lands.
  const announce =
    m.status === "done" && m.accuracy?.kind === "done" ? [GAME_OVER_COPY.ready, m.accuracy.label, m.coachLine].filter(Boolean).join(". ") : "";
  return (
    <>
      <span className="sr-only" aria-live="polite" data-testid="review-announce">
        {announce}
      </span>
      {p ? <PrimaryButton facts={facts} m={m} p={p} /> : null}
    </>
  );
}

function PrimaryButton({ facts, m, p }: { facts: GameFacts; m: GameOverModel; p: NonNullable<GameOverModel["primary"]> }) {
  if (p.kind === "analysing") {
    return (
      <button type="button" className="g-btn-p rv-go-primary" disabled data-testid="review-analysing">
        <span className="g-spin" aria-hidden="true" />
        {GAME_OVER_COPY.analysing(p.pct)}
      </button>
    );
  }
  const coach = p.kind === "coach";
  return (
    <Link
      className="g-btn-p rv-go-primary"
      href={gameOverReviewPath(facts.ref)}
      prefetch={coach}
      onClick={() => trackReview("game_over_review_clicked", { status_at_click: m.status, has_coach_line: m.coachLine !== null, legend: m.legend !== null })}
      data-testid={coach ? "review-coach-cta" : "review-open"}
    >
      {coach ? GAME_OVER_COPY.coachCta : GAME_OVER_COPY.openReview}
      <ArrowIcon />
    </Link>
  );
}

export function ReviewAccuracySlot() {
  const facts = useGameFacts();
  if (!facts) return null;
  return <Accuracy facts={facts} />;
}

function Accuracy({ facts }: { facts: GameFacts }) {
  const a = useModel(facts, false).accuracy;
  if (!a) return null;
  return (
    <div className="rv-go-acc" data-testid="review-accuracy">
      <span className="g-lbl">{a.label}</span>
      {a.kind === "analysing" ? (
        <div
          className="rv-go-bar"
          role="progressbar"
          aria-valuenow={a.pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={GAME_OVER_COPY.progressLabel}
        >
          <span style={{ width: `${a.pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export function ReviewCoachSlot() {
  const facts = useGameFacts();
  if (!facts) return null;
  return <Coach facts={facts} />;
}

function Coach({ facts }: { facts: GameFacts }) {
  const line = useModel(facts, false).coachLine;
  if (!line) return null;
  // Announced by the primary's live region (it exists before the line arrives; this slot does not).
  return (
    <div className="rv-go-coach" data-testid="review-coach-line">
      <span className="rv-go-rk" aria-hidden="true">
        {GAME_OVER_COPY.coachMarker}
      </span>
      <span className="rv-go-coach__text">{line}</span>
    </div>
  );
}

export function ReviewLegendSlot() {
  const facts = useGameFacts();
  if (!facts || !facts.legend) return null;
  return <Legend facts={facts} />;
}

function Legend({ facts }: { facts: GameFacts }) {
  const c = useModel(facts, false).legend;
  if (!c) return null;
  return <LegendBlock c={c} />;
}

/** The `over_legend` block (exported for the /dev/ui demo). */
export function LegendBlock({ c }: { c: LegendSummaryDTO }) {
  const line = legendLine(c);
  const replay = replayLink(c);
  return (
    <div className="rv-go-legend" data-testid="review-legend">
      <span className="g-lbl rv-go-legend__lbl">{GAME_OVER_COPY.legendLabel}</span>
      {line.kind === "followed" ? (
        <span className="rv-go-legend__line">{line.text}</span>
      ) : (
        <span className="rv-go-legend__line">
          {line.lead}
          <b>{line.matched}</b>
          {line.middle}
          <span className="g-mono">{line.yours}</span>
          {line.between}
          <span className="g-mono rv-go-legend__theirs">{line.theirs}</span>
          {line.end}
        </span>
      )}
      <span className="rv-go-legend__outcome">{c.outcomeLine}</span>
      {c.rows.length > 0 ? (
        <div className="rv-go-lgrid" role="table" aria-label={`Your moves and ${c.legendName}’s`}>
          <div role="row" className="rv-go-lgrid__row">
            <span role="columnheader" className="g-lbl">
              <span className="sr-only">Move</span>
            </span>
            <span role="columnheader" className="g-lbl">
              You
            </span>
            <span role="columnheader" className="g-lbl rv-go-legend__theirs">
              {c.legendName}
            </span>
            <span role="columnheader">
              <span className="sr-only">Same move</span>
            </span>
          </div>
          {c.rows.map((r) => (
            <div role="row" className="rv-go-lgrid__row" key={r.n}>
              <span role="cell" className="rv-go-lgrid__n">
                {r.n}
              </span>
              <span role="cell">{r.yours}</span>
              <span role="cell" className="rv-go-legend__theirs">
                {r.legend}
              </span>
              <span role="cell" className="rv-go-lgrid__mark" data-mark={r.mark}>
                {r.mark === "match" ? "✓" : r.mark === "split" ? "×" : ""}
                <span className="sr-only">{r.mark === "match" ? "same move" : r.mark === "split" ? "left the path" : ""}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {replay ? (
        <Link
          className="g-btn-t rv-go-legend__replay"
          href={replay.href}
          prefetch={false}
          onClick={() => trackReview("game_over_replay_clicked", { divergence_ply_bucket: bucket10(replay.ply) })}
          data-testid="legend-replay"
          data-hit="44"
        >
          {replay.label}
        </Link>
      ) : null}
      <Link
        className="g-act rv-go-legend__compare"
        href={c.compareHref}
        prefetch={false}
        onClick={() => trackReview("legend_compare_opened", { from: "game_over", status: c.status })}
        data-testid="legend-compare"
      >
        {GAME_OVER_COPY.compareWith(c.legendName)}
      </Link>
    </div>
  );
}
