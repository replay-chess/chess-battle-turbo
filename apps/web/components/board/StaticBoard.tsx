/**
 * StaticBoard (phase-04 plan §4.0): a FEN as inline SVG for asides and cards. No hooks, no client JavaScript of its
 * own and no chess.js: 64 squares in ChessBoard's neutral colours (`--board-light-center` / `--board-dark-center`),
 * pieces as <image> from public/chess-icons, optional last-move squares, `role="img"` + `aria-label`. No ids inside
 * (no gradients): the onboarding frame renders the same board in two or three places, only one of them displayed.
 *
 * It fills its container's width (square); size it from CSS. Orientation follows `orientation` (default: the side to
 * move, as the onboarding boards show it).
 */
import { displayPos, isDarkSquare, parsePlacement, SQUARES, sideToMove } from "./geometry";
import type { PieceCode, Side, Sq } from "./types";

/** Not PieceLayer's `pieceSrc`: that module is a client component, and a server component may not call into it. */
const pieceHref = (p: PieceCode) => `/chess-icons/${p}.png`;

export type StaticBoardProps = {
  fen: string;
  /** Accessible name ("Kasparov vs Topalov 1999, after 23…Qd6. White to move."). */
  label: string;
  orientation?: Side;
  lastMove?: readonly [Sq, Sq] | null;
  className?: string;
  "data-testid"?: string;
};

export function StaticBoard({ fen, label, orientation, lastMove, className, "data-testid": testId = "static-board" }: StaticBoardProps) {
  const side = orientation ?? sideToMove(fen);
  const placement = parsePlacement(fen);
  return (
    <svg
      viewBox="0 0 8 8"
      role="img"
      aria-label={label}
      focusable="false"
      className={className}
      data-testid={testId}
      data-fen={fen}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", width: "100%", height: "auto", aspectRatio: "1 / 1" }}
    >
      {SQUARES.map((sq) => {
        const { col, row } = displayPos(sq, side);
        return (
          <rect
            key={sq}
            x={col}
            y={row}
            width={1}
            height={1}
            shapeRendering="crispEdges"
            style={{ fill: isDarkSquare(sq) ? "var(--board-dark-center)" : "var(--board-light-center)" }}
          />
        );
      })}
      {lastMove
        ? lastMove.map((sq) => {
            const { col, row } = displayPos(sq, side);
            return <rect key={`last-${sq}`} x={col} y={row} width={1} height={1} style={{ fill: "var(--article-board-last)" }} />;
          })
        : null}
      {[...placement].map(([sq, p]) => {
        const { col, row } = displayPos(sq, side);
        return <image key={sq} href={pieceHref(p)} x={col + 0.04} y={row + 0.04} width={0.92} height={0.92} />;
      })}
    </svg>
  );
}
