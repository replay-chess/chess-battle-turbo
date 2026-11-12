"use client";

// ReviewMoveList (plan §4.1; V3ReviewSummary Moves tab): the sticky current-move line ("19.Qd2 · Miss. Missed Rxf5,
// which wins a bishop.") over a two-column list with 18 px badges as plies are graded; `aria-current` on the viewed
// ply, kept in view inside the panel. ReviewMoveStrip is the phone/iPad-portrait version: 7 plies with 16 px badges,
// scrolling sideways, and the same current line under it.

import { Fragment, useEffect, useRef } from "react";
import { COPY, QUALITY_LABEL, ungradedMove } from "../copy";
import { useReview, useView } from "../context";
import { judgementAt, moveRows, moveText, reasonAt, stripCells, type MoveCell } from "../model";
import { QualityBadge } from "./QualityBadge";

/** "19.Qd2 · Miss. Missed Rxf5, which wins a bishop." for the viewed ply. */
export function CurrentMoveLine({ sticky = true }: { sticky?: boolean }) {
  const { dto, plies } = useReview();
  const ply = useView((v) => v.ply);
  if (ply < 0) {
    return (
      <div className={sticky ? "rv-cur" : undefined} data-testid="current-move">
        <p>{COPY.startPosition}</p>
      </div>
    );
  }
  const key = judgementAt(dto.analysis, ply);
  // An ungraded ply reads "Still analysing" only while the engine can still reach it (ungradedMove: a skipped game's
  // moves say why there is no grade, never that the engine "did not reach" them).
  const ungraded = ungradedMove(dto.status);
  const reason = key || ungraded.reason === null ? reasonAt(plies, dto.analysis, ply) : ungraded.reason;
  const text = (
    <p>
      <span className="rv-mono">{moveText(plies, ply)}</span> · {key ? QUALITY_LABEL[key] : ungraded.label}. {reason}
    </p>
  );
  if (!sticky) {
    return (
      <div data-testid="current-move" style={{ fontSize: 14 }}>
        {text}
      </div>
    );
  }
  return (
    <div className="rv-cur" data-testid="current-move">
      {key ? <QualityBadge q={key} size={22} /> : null}
      {text}
    </div>
  );
}

function Cell({ cell, current, onPick }: { cell: MoveCell | null; current: number; onPick: (ply: number) => void }) {
  if (!cell) return <span />;
  const aria = `${cell.text}${cell.key ? `, ${QUALITY_LABEL[cell.key]}` : ""}`;
  return (
    <button
      type="button"
      className="rv-mv"
      aria-current={cell.ply === current ? "true" : undefined}
      aria-label={aria}
      data-ply={cell.ply}
      onClick={() => onPick(cell.ply)}
    >
      <span>{cell.san}</span>
      {cell.key ? <QualityBadge q={cell.key} size={18} decorative /> : null}
    </button>
  );
}

export function ReviewMoveList() {
  const { dto, plies } = useReview();
  const ply = useView((v) => v.ply);
  const setPly = useView((v) => v.setPly);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = moveRows(plies, dto.analysis);

  // Keep the active row in view inside the panel. The scroller is found and moved directly (scrollIntoView would also
  // move every scrollable ancestor, including the shell's main, on a one-viewport page).
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    const scroller = listRef.current?.closest<HTMLElement>("[data-rv-scroll]");
    if (!el || !scroller) return;
    const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const sticky = 56; // the current-move line stays on top
    if (top < sticky) scroller.scrollTop += top - sticky;
    else if (top + el.offsetHeight > scroller.clientHeight) scroller.scrollTop += top + el.offsetHeight - scroller.clientHeight + 8;
  }, [ply]);

  return (
    <div data-testid="review-moves">
      <CurrentMoveLine />
      <div className="rv-moves" ref={listRef} role="group" aria-label={COPY.movesRegion}>
        {rows.map((r) => (
          <Fragment key={r.no}>
            <span className="rv-moves__no" aria-hidden="true">
              {r.no}.
            </span>
            <Cell cell={r.w} current={ply} onPick={setPly} />
            <Cell cell={r.b} current={ply} onPick={setPly} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export function ReviewMoveStrip() {
  const { dto, plies } = useReview();
  const ply = useView((v) => v.ply);
  const setPly = useView((v) => v.setPly);
  const cells = stripCells(plies, dto.analysis, ply);
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = stripRef.current;
    const el = strip?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!strip || !el) return;
    strip.scrollLeft = el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2;
  }, [ply]);
  return (
    <div className="rv-strip" data-rv-stack="" role="group" aria-label={COPY.movesRegion} ref={stripRef} data-testid="review-strip" data-hit="44">
      {cells.map((c) => {
        const key = judgementAt(dto.analysis, c.ply);
        return (
          <button
            key={c.ply}
            type="button"
            aria-current={c.ply === ply ? "true" : undefined}
            aria-label={`${c.text}${key ? `, ${QUALITY_LABEL[key]}` : ""}`}
            onClick={() => setPly(c.ply)}
          >
            {c.text}
            {key ? <QualityBadge q={key} size={16} decorative /> : null}
          </button>
        );
      })}
    </div>
  );
}
