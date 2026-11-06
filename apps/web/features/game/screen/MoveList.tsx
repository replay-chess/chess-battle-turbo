"use client";

// The move list (plan 4.6.3): cells are buttons with aria-current on the viewed ply; a legend prefix renders muted
// (sky) and is not clickable, followed by the dashed "Game starts here" divider. Viewing history never pauses the
// clock. Side mode renders it in the panel; stack mode in the moves Sheet (MoveStrip).

import { Fragment, useState } from "react";
import { absPly } from "@repo/game-core/client/reducer";
import { sanLine, splitMoves } from "@repo/game-core/rules/chess";
import type { GameState } from "@repo/game-core/machine/types";
import { ScrollRegion } from "@/components/layout/ScrollRegion";
import { BUTTONS } from "../copy";
import { windowStart } from "../moveWindow";
import { useDispatch, useGame } from "./GameContext";

export interface MoveCell {
  /** Absolute ply. */
  ply: number;
  san: string;
  prefix: boolean;
}

interface Row {
  no: number;
  w: MoveCell | null;
  b: MoveCell | null;
  divider: boolean;
}

let sanMemo: { key: string; sans: string[] } | null = null;

/** SAN of the game's own moves (one-entry cache: the list, the strip and the viewing label share it). */
export function gameSans(state: GameState): string[] {
  const key = `${state.startFen}|${state.moves}`;
  if (sanMemo?.key === key) return sanMemo.sans;
  const sans = sanLine(state.startFen, splitMoves(state.moves));
  sanMemo = { key, sans };
  return sans;
}

/** Every cell in order: the legend prefix (muted, before `startPly`) then the game's own moves. */
export function moveCells(state: GameState): MoveCell[] {
  const out: MoveCell[] = [];
  const prefix = state.prefix.sans.trim() ? state.prefix.sans.trim().split(/\s+/) : [];
  if (prefix.length) {
    let ply = (state.prefix.startMoveNo - 1) * 2 + (state.prefix.startsBlack ? 2 : 1);
    for (const san of prefix) out.push({ ply: ply++, san, prefix: true });
  }
  gameSans(state).forEach((san, i) => out.push({ ply: state.startPly + i + 1, san, prefix: false }));
  return out;
}

function rowsOf(cells: MoveCell[]): Row[] {
  const rows: Row[] = [];
  let sawPrefix = false;
  let divided = false;
  for (const c of cells) {
    const no = Math.floor((c.ply - 1) / 2) + 1;
    const white = c.ply % 2 === 1;
    let row = rows[rows.length - 1];
    const needsDivider = !c.prefix && sawPrefix && !divided;
    if (!row || row.no !== no || (white && row.w) || needsDivider) {
      row = { no, w: null, b: null, divider: needsDivider };
      rows.push(row);
    }
    if (needsDivider) divided = true;
    if (c.prefix) sawPrefix = true;
    if (white) row.w = c;
    else row.b = c;
  }
  return rows;
}

export function MoveList({ label = "Moves" }: { label?: string }) {
  const state = useGame((g) => g.state);
  const view = useGame((g) => g.view);
  const dispatch = useDispatch();
  const [all, setAll] = useState(false);
  const live = absPly(state);
  const current = view ?? live;
  const allRows = rowsOf(moveCells(state));
  const start = windowStart(allRows, current, all);
  const rows = start > 0 ? allRows.slice(start) : allRows;

  const cell = (c: MoveCell | null) => {
    if (!c) return <span />;
    if (c.prefix) {
      return (
        <button type="button" className="g-mv" data-prefix="" disabled aria-label={`${c.san}, before the game`}>
          {c.san}
        </button>
      );
    }
    return (
      <button
        type="button"
        className="g-mv"
        aria-current={c.ply === current ? "true" : undefined}
        onClick={() => dispatch({ type: "view", ply: c.ply >= live ? null : c.ply })}
        data-ply={c.ply}
      >
        {c.san}
      </button>
    );
  };

  return (
    <ScrollRegion label={label} className="g-moves" data-testid="move-list">
      <div className="g-moves__grid">
        {rows.length === 0 ? <span className="g-empty" style={{ gridColumn: "1 / -1" }} /> : null}
        {start > 0 ? (
          <button
            type="button"
            className="g-mv"
            style={{ gridColumn: "1 / -1", textAlign: "center" }}
            onClick={() => setAll(true)}
            data-testid="move-list-earlier"
          >
            {BUTTONS.earlierMoves}
          </button>
        ) : null}
        {rows.map((r, i) => (
          <Fragment key={`${r.no}-${i}`}>
            {r.divider ? <div className="g-divider">Game starts here</div> : null}
            <span className="g-moves__no">{r.no}.</span>
            {cell(r.w)}
            {cell(r.b)}
          </Fragment>
        ))}
      </div>
    </ScrollRegion>
  );
}
