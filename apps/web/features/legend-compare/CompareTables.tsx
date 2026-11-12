"use client";

// The Your Moves and the legend's moves tables (phase-03 plan §4.6; V3LegendCompare `role="table"` grids, merged with
// V3TryCompare's "Paths split here" divider). Your table: No., White, Black and the mark (✓ matched, × left the
// path, blank after it). The legend's table: the same columns with the legend's moves in sky blue AND the legend's
// colour named in its column header ("White · Morphy"), so colour is never the only cue. Every move is a button that
// puts the board on that position of that line (aria-current marks the one on the board).
import { Fragment } from "react";
import type { LegendLineRow } from "@repo/contracts/http/legend";
import { tableRows, type LineKey, type Side, type TableCell } from "./model";

const MARK_TEXT = { match: "✓", split: "×", none: "" } as const;
const MARK_LABEL = { match: "Matched", split: "Left the path", none: "" } as const;

function Cell({
  cell,
  line,
  activeLine,
  activePos,
  onPick,
  sky,
}: {
  cell: TableCell | null;
  line: LineKey;
  activeLine: LineKey;
  activePos: number;
  onPick: (line: LineKey, pos: number) => void;
  sky: boolean;
}) {
  return (
    <span className="lc-cell" role="cell">
      {cell ? (
        <button
          type="button"
          className={sky ? "lc-sky" : undefined}
          aria-current={activeLine === line && activePos === cell.pos ? "true" : undefined}
          onClick={() => onPick(line, cell.pos)}
        >
          {cell.san}
        </button>
      ) : null}
    </span>
  );
}

export function LineTable({
  rows,
  line,
  startPly,
  divergencePly,
  legendName,
  legendSide,
  activeLine,
  activePos,
  onPick,
}: {
  rows: readonly LegendLineRow[];
  line: LineKey;
  startPly: number;
  divergencePly: number | null;
  legendName: string;
  /** The colour the legend played (the member's colour). */
  legendSide: Side;
  activeLine: LineKey;
  activePos: number;
  onPick: (line: LineKey, pos: number) => void;
}) {
  const legend = line === "legend";
  const caption = legend ? `${legendName}’s moves` : "Your moves";
  const head = (side: Side) => {
    const colour = side === "w" ? "White" : "Black";
    return legend && side === legendSide ? `${colour} · ${legendName}` : colour;
  };
  const table = tableRows(rows, startPly, divergencePly === null ? null : { ply: divergencePly });
  return (
    <div role="table" aria-label={caption} className="lc-table" data-testid={legend ? "compare-legend-table" : "compare-your-table"}>
      <div role="row">
        <span role="columnheader" className="lc-lbl">
          <span className="sr-only">Move</span>
        </span>
        <span role="columnheader" className={legend && legendSide === "w" ? "lc-lbl lc-sky" : "lc-lbl"}>
          {head("w")}
        </span>
        <span role="columnheader" className={legend && legendSide === "b" ? "lc-lbl lc-sky" : "lc-lbl"}>
          {head("b")}
        </span>
        <span role="columnheader" className="lc-lbl">
          <span className="sr-only">{legend ? "" : "Mark"}</span>
        </span>
      </div>
      {table.map((r) => (
        <Fragment key={r.n}>
          {r.splitAbove ? (
            <div role="row">
              <span className="lc-split" role="cell" aria-colspan={4} data-testid="compare-split-divider">
                Paths split here
              </span>
            </div>
          ) : null}
          <div role="row" data-mark={legend ? undefined : r.mark}>
          <span role="rowheader" className="lc-table__no">
            {r.n}
          </span>
          <Cell cell={r.w} line={line} activeLine={activeLine} activePos={activePos} onPick={onPick} sky={legend && legendSide === "w"} />
          <Cell cell={r.b} line={line} activeLine={activeLine} activePos={activePos} onPick={onPick} sky={legend && legendSide === "b"} />
          <span role="cell" className="lc-mark" data-mark={legend ? "none" : r.mark}>
            {legend ? null : (
              <>
                <span aria-hidden="true">{MARK_TEXT[r.mark]}</span>
                {r.mark !== "none" ? <span className="sr-only">{MARK_LABEL[r.mark]}</span> : null}
              </>
            )}
          </span>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
