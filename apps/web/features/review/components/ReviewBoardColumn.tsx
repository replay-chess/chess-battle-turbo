"use client";

// The board column (plan §4.1 "ReviewBoardColumn"): both player strips, the eval bar and P2's Board. The top strip
// carries the position label (side mode) or the horizontal eval bar (stack mode); the bottom strip carries the eval
// words and "Accuracy 85 · opp 89". Which player sits on top follows the board's orientation (Flip Board).
// In a key moment the board is the walkthrough's (moments.ts `momentBoard`): input on while answering (checked
// locally against `moment.accept`), rings on a wrong try, the found move, the reveal arrow, the best line.

import { useEffect } from "react";
import { Board } from "@/components/board/Board";
import { afterPaint } from "@/lib/sentry/review";
import type { BoardArrow, BoardBadge, BoardMove, Sq } from "@/components/board/types";
import type { PlayerCard } from "@repo/contracts/http/review";
import { accuracyLine, accuracyPhase, COLOUR_NAME, QUALITY_LABEL } from "../copy";
import { useReview, useView } from "../context";
import { evalAt, evalWords, judgementAt, other, positionLabel, scoreText, whiteShare, type Side } from "../model";
import { destsOf, momentBoard } from "../moments";
import { useMomentWalkthrough } from "../useMomentWalkthrough";

const NO_DESTS = (): Sq[] => [];

/**
 * The lab gate "board interaction in moments: tap → highlight ≤ 50 ms" (plan §9.1, FIX-1): a mark when the board hands
 * a move to the walkthrough and a measure at the first paint that shows its result (the rings, the found move or the
 * reveal). The e2e spec review-perf reads the measure; outside a moment nothing is marked.
 */
export const TAP_MARK = "rv:move";
export const TAP_MEASURE = "rv:tap-highlight";
// Outside key moments the review board takes no input.
const NO_MOVE = (): void => undefined;

export interface BoardPosition {
  fen: string;
  last: [Sq, Sq] | null;
  check: Sq | null;
  /** The game position whose eval the bars show. */
  position: number;
  /** The ply in the move list (data-ply), −1 for the start. */
  ply: number;
  badge: BoardBadge | null;
  arrows: BoardArrow[];
  rings: Partial<Record<Sq, string>>;
  highlights: Partial<Record<Sq, string>>;
  /** The side that may play a try in a moment, else null. */
  mover: Side | null;
  label: string;
}

/** What the board shows: the ply's position in the move list, or the key moment's board in the walkthrough. */
export function useBoardPosition(): BoardPosition {
  const { dto, plies } = useReview();
  const ply = useView((v) => v.ply);
  const mode = useView((v) => v.mode);
  const momentIndex = useView((v) => v.momentIndex);
  const phase = useView((v) => v.phase);
  const tried = useView((v) => v.tried);
  const accepted = useView((v) => v.accepted);
  const lineN = useView((v) => v.lineN);
  const moment = mode === "moment" ? (dto.review?.moments[momentIndex] ?? null) : null;
  if (moment) {
    const b = momentBoard({ plies, moment, phase, tried, accepted, lineN });
    return {
      fen: b.fen,
      last: b.lastMove ? [b.lastMove[0] as Sq, b.lastMove[1] as Sq] : null,
      check: (b.check ?? null) as Sq | null,
      position: b.position,
      ply: moment.ply - 1,
      badge: b.badge ? { sq: b.badge.sq as Sq, kind: b.badge.kind, label: b.badge.label } : null,
      arrows: b.arrows.map((a) => ({ from: a.from as Sq, to: a.to as Sq, color: a.color })),
      rings: b.rings as Partial<Record<Sq, string>>,
      highlights: b.highlights as Partial<Record<Sq, string>>,
      mover: b.mover,
      label: b.label,
    };
  }
  const position = ply + 1;
  const mv = ply >= 0 ? plies.moves[ply] : undefined;
  const key = judgementAt(dto.analysis, ply);
  const badge: BoardBadge | null = mv && key ? { sq: mv.to as Sq, kind: key, label: QUALITY_LABEL[key] } : null;
  return {
    fen: plies.fens[position] ?? plies.fens[plies.fens.length - 1]!,
    last: mv ? ([mv.from, mv.to] as [Sq, Sq]) : null,
    check: (plies.checks[position] ?? null) as Sq | null,
    position,
    ply,
    badge,
    arrows: [],
    rings: {},
    highlights: {},
    mover: null,
    label: positionLabel(plies, ply),
  };
}

function useOrientation(): Side {
  const { dto } = useReview();
  const flipped = useView((v) => v.flipped);
  return flipped ? other(dto.you) : dto.you;
}

export function ReviewBoardArea() {
  const { dto } = useReview();
  const pos = useBoardPosition();
  const orientation = useOrientation();
  const walk = useMomentWalkthrough();
  const e = evalAt(dto.analysis, pos.position);
  const share = whiteShare(e);
  const evalLabel =
    e === null ? "Evaluation not graded yet" : `White winning chances ${Math.round(share)} percent, ${scoreText(e, dto.you)} for you`;
  const dests = pos.mover ? (from: Sq) => (destsOf(pos.fen).get(from) ?? []) as Sq[] : NO_DESTS;
  const onMove = (m: BoardMove) => {
    performance.mark(TAP_MARK);
    walk.tryMove(m);
  };
  // The commit after a move: measure at its paint (the board's rings, last move, arrows or input changed).
  const shown = `${pos.fen}|${pos.last?.join("") ?? ""}|${Object.keys(pos.rings).join("")}|${pos.arrows.length}|${pos.mover ?? ""}`;
  useEffect(() => {
    if (performance.getEntriesByName(TAP_MARK, "mark").length === 0) return;
    return afterPaint(() => {
      if (performance.getEntriesByName(TAP_MARK, "mark").length === 0) return;
      performance.measure(TAP_MEASURE, TAP_MARK);
      performance.clearMarks(TAP_MARK);
    });
  }, [shown]);
  return (
    <div className="rv-boardarea" data-testid="review-board" data-ply={pos.ply} data-position={pos.position} data-input={pos.mover ? "" : undefined}>
      <div
        className="rv-evalbar"
        role="img"
        aria-label={evalLabel}
        data-flip={orientation === "b" ? "" : undefined}
        data-testid="review-evalbar"
      >
        <span style={{ height: `${orientation === "w" ? share : 100 - share}%` }} />
      </div>
      <Board
        fen={pos.fen}
        orientation={orientation}
        mover={pos.mover}
        dests={dests}
        onMove={pos.mover ? onMove : NO_MOVE}
        lastMove={pos.last}
        check={pos.check}
        badges={pos.badge ? [pos.badge] : []}
        arrows={pos.arrows}
        rings={pos.rings}
        highlights={pos.highlights}
        label={`Game review board. ${pos.label}${pos.mover ? `. ${COLOUR_NAME[pos.mover]} to play: your move.` : ""}`}
        animationMs={120}
      />
    </div>
  );
}

function PlayerName({ card, side }: { card: PlayerCard; side: Side }) {
  return (
    <span className="rv-pbar__who">
      <span className="rv-av" data-ink={card.isYou ? "" : undefined} aria-hidden="true">
        {card.initials}
      </span>
      <span className="rv-name">{card.name}</span>
      <span className="rv-pbar__meta rv-mono">
        {card.rating !== null ? `${card.kind === "bot" ? "≈" : ""}${card.rating}` : ""}
        <span data-colour="">{card.rating !== null ? " · " : ""}{COLOUR_NAME[side]}</span>
      </span>
    </span>
  );
}

export function ReviewPlayerStrip({ pos }: { pos: "top" | "bottom" }) {
  const { dto } = useReview();
  const orientation = useOrientation();
  const board = useBoardPosition();
  const side: Side = pos === "bottom" ? orientation : other(orientation);
  const card = dto.players[side];
  if (pos === "top") {
    const e = evalAt(dto.analysis, board.position);
    const share = whiteShare(e);
    return (
      <div className="rv-pbar" data-testid="review-bar-top" data-side={side}>
        <PlayerName card={card} side={side} />
        <span className="rv-pbar__pos rv-mono" data-rv-side="" data-testid="review-position-label">
          {board.label}
        </span>
        <span
          className="rv-hevalbar"
          data-rv-stack=""
          role="img"
          aria-label={e === null ? "Evaluation not graded yet" : `White winning chances ${Math.round(share)} percent`}
          data-flip={orientation === "b" ? "" : undefined}
        >
          <span style={{ width: `${orientation === "w" ? share : 100 - share}%` }} />
        </span>
      </div>
    );
  }
  const acc = dto.analysis?.accuracy;
  const line = accuracyLine(acc?.[dto.you] ?? null, acc?.[other(dto.you)] ?? null, accuracyPhase(dto.status));
  const words = evalWords(evalAt(dto.analysis, board.position));
  return (
    <div className="rv-pbar" data-testid="review-bar-bottom" data-side={side}>
      <PlayerName card={card} side={side} />
      <span className="rv-pbar__right">
        {words ? <span className="rv-pbar__words">{words}</span> : null}
        {line ? (
          <span className="rv-mono rv-soft" data-testid="review-accuracy">
            {line}
          </span>
        ) : null}
      </span>
    </div>
  );
}
