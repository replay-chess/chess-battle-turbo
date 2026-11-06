"use client";

/**
 * The 64 cells (P2 plan §4.5.1 SquareLayer, §4.5.5): `role="grid"` with 8 rows of
 * `gridcell` buttons labelled "e4, white knight" / "e4, empty", one roving tab
 * stop, `aria-describedby` "legal move" on targets. Every cell carries
 * `data-square` (the e2e hook) and holds its marks, piece and ghost, so the cell
 * markup changes only where a square changes.
 */
import type { KeyboardEvent } from "react";
import { Ghost } from "./Ghost";
import { isKeyboardClick } from "./logic";
import { SquareMarks, type SquareMarksProps } from "./OverlayLayer";
import { FadingPiece, PieceSprite } from "./PieceLayer";
import { isDarkSquare, squareAtDisplay, type DiffedPiece, type PlacedPiece } from "./geometry";
import type { PieceCode, Side, Sq } from "./types";

export interface CellModel extends SquareMarksProps {
  sq: Sq;
  dark: boolean;
  label: string;
  piece?: DiffedPiece;
  removed?: PlacedPiece;
  ghost?: PieceCode;
  movable: boolean;
  shake?: "a" | "b";
  lifted: boolean;
}

function SquareCell({
  cell,
  orientation,
  animate,
  interactive,
  focusable,
  tabbable,
  legalId,
  onActivate,
  onFocusCell,
}: {
  cell: CellModel;
  orientation: Side;
  animate: boolean;
  interactive: boolean;
  focusable: boolean;
  tabbable: boolean;
  legalId: string;
  onActivate: (sq: Sq) => void;
  onFocusCell: (sq: Sq) => void;
}) {
  const sliding = animate && !!cell.piece?.from;
  const content = (
    <>
      <SquareMarks
        last={cell.last}
        highlight={cell.highlight}
        selected={cell.selected}
        premove={cell.premove}
        check={cell.check}
        ring={cell.ring}
        target={cell.target}
      />
      {cell.removed && animate ? <FadingPiece key={`${cell.removed.id}-fade`} piece={cell.removed} /> : null}
      {cell.piece ? (
        <PieceSprite
          key={cell.piece.id}
          piece={cell.piece}
          orientation={orientation}
          animate={animate}
          shake={cell.shake}
          lifted={cell.lifted}
        />
      ) : null}
      {cell.ghost ? <Ghost piece={cell.ghost} /> : null}
    </>
  );
  const data = {
    "data-square": cell.sq,
    "data-dark": cell.dark ? "" : undefined,
    "data-movable": interactive && cell.movable ? "" : undefined,
    "data-target": cell.target ?? undefined,
    "data-selected": cell.selected ? "" : undefined,
    "data-last": cell.last ? "" : undefined,
    "data-check": cell.check ? "" : undefined,
    "data-premove": cell.premove ? "" : undefined,
    "data-sliding": sliding ? "" : undefined,
    "data-lift": cell.lifted ? "" : undefined,
    "data-shake": cell.shake ? "" : undefined,
  };
  // Thumb boards are pictures: plain cells, nothing focusable inside the role="img" root.
  if (!focusable) {
    return (
      <div className="rc-bd-cell" {...data}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      role="gridcell"
      className="rc-bd-cell"
      {...data}
      aria-label={cell.label}
      aria-selected={cell.selected ? true : undefined}
      aria-describedby={cell.target ? legalId : undefined}
      tabIndex={tabbable ? 0 : -1}
      onFocus={() => onFocusCell(cell.sq)}
      onClick={(e) => {
        // Pointer input is handled on pointerdown by useBoardInput; only keyboard/AT activations come through here.
        if (isKeyboardClick(e)) onActivate(cell.sq);
      }}
    >
      {content}
    </button>
  );
}

/**
 * Coordinates: rank on the left column (top-left), file on the bottom row
 * (bottom-right), in one aria-hidden layer so the cells' visible text never
 * differs from their accessible names ("e4, white knight").
 */
export function CoordLayer({ orientation }: { orientation: Side }) {
  const items: { key: string; sq: Sq; kind: "rank" | "file"; text: string; style: React.CSSProperties }[] = [];
  for (let i = 0; i < 8; i++) {
    const rankSq = squareAtDisplay(0, i, orientation)!;
    items.push({ key: `r${i}`, sq: rankSq, kind: "rank", text: rankSq[1]!, style: { top: `calc(${i * 12.5}% + 0.6cqw)`, left: "0.6cqw" } });
    const fileSq = squareAtDisplay(i, 7, orientation)!;
    items.push({
      key: `f${i}`,
      sq: fileSq,
      kind: "file",
      text: fileSq[0]!,
      style: { bottom: "0.6cqw", right: `calc(${(7 - i) * 12.5}% + 0.6cqw)` },
    });
  }
  return (
    <div aria-hidden="true" className="rc-bd-coords">
      {items.map((c) => (
        <span key={c.key} className="rc-bd-coord" data-kind={c.kind} data-coord={c.sq} data-dark={isDarkSquare(c.sq) ? "" : undefined} style={c.style}>
          {c.text}
        </span>
      ))}
    </div>
  );
}

export function SquareLayer({
  rows,
  orientation,
  label,
  thumb,
  interactive,
  animate,
  tabStop,
  legalId,
  onActivate,
  onFocusCell,
  onKeyDown,
}: {
  rows: CellModel[][];
  orientation: Side;
  label: string;
  thumb: boolean;
  interactive: boolean;
  animate: boolean;
  tabStop: Sq;
  legalId: string;
  onActivate: (sq: Sq) => void;
  onFocusCell: (sq: Sq) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  return (
    <div
      role={thumb ? undefined : "grid"}
      aria-label={thumb ? undefined : label}
      aria-hidden={thumb ? true : undefined}
      className="rc-bd-grid"
      data-orientation={orientation}
      onKeyDown={thumb ? undefined : onKeyDown}
    >
      {rows.map((row, r) => (
        <div key={r} role={thumb ? undefined : "row"} className="rc-bd-row">
          {row.map((cell) => (
            <SquareCell
              key={cell.sq}
              cell={cell}
              orientation={orientation}
              animate={animate}
              interactive={interactive}
              focusable={!thumb}
              tabbable={cell.sq === tabStop}
              legalId={legalId}
              onActivate={onActivate}
              onFocusCell={onFocusCell}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
