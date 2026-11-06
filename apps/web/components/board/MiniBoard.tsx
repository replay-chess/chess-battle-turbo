/**
 * MiniBoard (P2 plan §4.5.1): a static SVG board for lists (live games sheet,
 * P3+ cards). 56 px by default, warm `article-board-*` squares, no coordinates,
 * no input, no client JavaScript.
 */
import { displayPos, parsePlacement, SQUARES, isDarkSquare } from "./geometry";
import { pieceSrc } from "./PieceLayer";
import type { Side, Sq } from "./types";

export function MiniBoard({
  fen,
  orientation = "w",
  size = 56,
  lastMove,
  label,
  className,
  testId = "mini-board",
}: {
  fen: string;
  orientation?: Side;
  size?: number;
  lastMove?: readonly [Sq, Sq] | null;
  /** Accessible name; omit for a decorative board next to its own text. */
  label?: string;
  className?: string;
  testId?: string;
}) {
  const placement = parsePlacement(fen);
  return (
    <svg
      viewBox="0 0 8 8"
      width={size}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={className}
      data-testid={testId}
      shapeRendering="crispEdges"
    >
      {SQUARES.map((sq) => {
        const { col, row } = displayPos(sq, orientation);
        return (
          <rect
            key={sq}
            x={col}
            y={row}
            width={1}
            height={1}
            style={{ fill: isDarkSquare(sq) ? "var(--article-board-dark)" : "var(--article-board-light)" }}
          />
        );
      })}
      {lastMove
        ? lastMove.map((sq) => {
            const { col, row } = displayPos(sq, orientation);
            return <rect key={`l-${sq}`} x={col} y={row} width={1} height={1} style={{ fill: "var(--article-board-last)" }} />;
          })
        : null}
      {[...placement].map(([sq, p]) => {
        const { col, row } = displayPos(sq, orientation);
        return <image key={sq} href={pieceSrc(p)} x={col + 0.05} y={row + 0.05} width={0.9} height={0.9} />;
      })}
    </svg>
  );
}
