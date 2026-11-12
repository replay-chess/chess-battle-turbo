"use client";

// KeyMomentStepper (phase-03 plan §4.1 `moment.*`; board V3KeyMoments): the panel of one key moment.
//   header   "Moment 1 of 3 · Move 17" and the progress dots
//   coach    the ask while answering, the why after (narrated through the coach card)
//   asking   the wrong-try status ("Not quite: …", role=status), "Play your move on the board, or pick your plan",
//            the five plan chips (aria-pressed; keys 1–5) and the picked chip's precomputed feedback
//   answered "You found it: …" (found), the chip feedback, the result rows (You played 17.b3 · Inaccuracy / Best was
//            Qc1 · green arrow), Show Line (key L) and the best line's SAN list (aria-live)
// The primary (Reveal the Answer / Next Moment / Finish Review) lives in the footers (useReviewPrimary). Slots that
// later phases light up are not rendered: the bank checkbox (P5, P3-D19), Ask about This Move (P7, P3-D20).

import { useReview, useView } from "../context";
import {
  bestRow,
  foundLine,
  isAnswered,
  isAsking,
  lineOf,
  MOMENT_COPY,
  momentHeader,
  momentSentences,
  PLAN_CHIPS,
  playedRow,
  triedLine,
} from "../moments";
import { moveNumber } from "../model";
import { useMomentWalkthrough } from "../useMomentWalkthrough";
import { CoachLine } from "./CoachLine";
import { QualityBadge } from "./QualityBadge";

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4v16l13-8z" />
    </svg>
  );
}

export function KeyMomentStepper() {
  const { dto, plies } = useReview();
  const walk = useMomentWalkthrough();
  const index = useView((v) => v.momentIndex);
  const phase = useView((v) => v.phase);
  const triedSan = useView((v) => v.triedSan);
  const accepted = useView((v) => v.accepted);
  const acceptedAs = useView((v) => v.acceptedAs);
  const planChip = useView((v) => v.planChip);
  const lineN = useView((v) => v.lineN);
  const moments = dto.review?.moments ?? [];
  const m = moments[Math.min(index, moments.length - 1)];
  if (!m) return null;

  const asking = isAsking(phase);
  const answered = isAnswered(phase);
  const found = (phase === "found" || phase === "found_retry") && accepted !== null;
  const before = plies.fens[Math.min(m.ply, plies.fens.length - 1)] ?? dto.game.startFen;
  const line = lineOf(before, m.line);
  const acceptedSan = found && accepted ? (lineOf(before, accepted)[0]?.san ?? m.bestSan) : m.bestSan;
  const feedback = planChip ? m.plan[planChip] : null;

  return (
    <div className="rv-section" data-plain="" data-testid="moment-panel" data-moment={index + 1} data-phase={phase}>
      <div className="rv-mhead">
        <span className="rv-lbl" data-testid="moment-header">
          {momentHeader(index, moments.length, moveNumber(dto.game.startPly, m.ply))}
        </span>
        <span aria-hidden="true" className="rv-dots">
          {moments.map((_, i) => (
            <span key={i} data-on={i <= index ? "" : undefined} data-cur={i === index ? "" : undefined} />
          ))}
        </span>
      </div>

      <CoachLine sentences={momentSentences(m, phase)} textStatus={dto.review?.textStatus ?? null} context="moment" />

      {asking ? (
        <div className="rv-mask">
          {phase === "tried" && triedSan ? (
            <div className="rv-note" data-tone="bad" role="status" data-testid="moment-tried">
              <span>{triedLine(triedSan)}</span>
            </div>
          ) : null}
          <span className="rv-lbl">{MOMENT_COPY.hint}</span>
          <div role="group" aria-label={MOMENT_COPY.chipsGroup} className="rv-chips" data-testid="plan-chips">
            {PLAN_CHIPS.map((c, i) => (
              <button
                key={c.key}
                type="button"
                className="rv-pchip"
                aria-pressed={planChip === c.key}
                aria-keyshortcuts={String(i + 1)}
                onClick={() => walk.pickChip(c.key)}
                data-testid={`plan-chip-${c.key}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          {feedback ? (
            <p className="rv-note" role="status" data-testid="plan-feedback">
              {feedback}
            </p>
          ) : null}
        </div>
      ) : null}

      {answered ? (
        <div className="rv-mask rv-fadein" data-testid="moment-answer">
          {found && acceptedAs ? (
            <div className="rv-note" data-tone="good" role="status" data-testid="moment-found">
              <CheckIcon />
              <span>{foundLine(m, acceptedSan, acceptedAs)}</span>
            </div>
          ) : null}
          {feedback ? (
            <p className="rv-p" data-testid="plan-feedback">
              {feedback}
            </p>
          ) : null}
          <div className="rv-mrows" data-testid="moment-rows">
            <QualityBadge q={m.judgement} size={22} decorative />
            <span>{playedRow(m)}</span>
            <QualityBadge q="best" size={22} decorative />
            <span>{bestRow(m)}</span>
          </div>
          <div className="rv-mactions">
            <button type="button" className="rv-btn-s" style={{ minHeight: 44 }} onClick={walk.showLine} aria-keyshortcuts="L" data-testid="show-line">
              <PlayIcon />
              {phase === "line" ? MOMENT_COPY.replayLine : MOMENT_COPY.showLine}
            </button>
          </div>
          {phase === "line" ? (
            <p className="rv-mono rv-mline" aria-live="polite" aria-label={MOMENT_COPY.lineLabel} data-testid="moment-line">
              {line.slice(0, Math.max(0, lineN)).map((p, i) => (
                <span key={`${i}-${p.uci}`} data-on="">
                  {p.san}
                </span>
              ))}
              {line.slice(Math.max(0, lineN)).map((p, i) => (
                <span key={`r${i}-${p.uci}`} aria-hidden="true">
                  {p.san}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
