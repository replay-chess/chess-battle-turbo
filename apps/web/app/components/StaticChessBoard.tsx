import Image from "next/image";

// Server-rendered, zero-JS board for public reference pages. Renders a FEN
// as a CSS grid using the same piece icons as the interactive ChessBoard, so
// crawlers and users on slow connections get the position without hydrating
// chess.js. Not interactive by design — training happens in the gated app.

const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

interface SquarePiece {
  color: "w" | "b";
  type: string;
}

/** Expands the placement field of a FEN into an 8x8 matrix (rank 8 first). */
function parseFenPlacement(fen: string): (SquarePiece | null)[][] | null {
  const placement = fen.trim().split(/\s+/)[0];
  if (!placement) return null;
  const ranks = placement.split("/");
  if (ranks.length !== 8) return null;

  const board: (SquarePiece | null)[][] = [];
  for (const rank of ranks) {
    const row: (SquarePiece | null)[] = [];
    for (const char of rank) {
      if (/[1-8]/.test(char)) {
        for (let i = 0; i < Number(char); i++) row.push(null);
      } else if (/[pnbrqk]/i.test(char)) {
        row.push({
          color: char === char.toLowerCase() ? "b" : "w",
          type: char.toLowerCase(),
        });
      } else {
        return null;
      }
    }
    if (row.length !== 8) return null;
    board.push(row);
  }
  return board;
}

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

export function StaticChessBoard({
  fen,
  caption,
}: {
  fen: string;
  caption?: string;
}) {
  const board = parseFenPlacement(fen);
  if (!board) return null;

  return (
    <figure className="w-full max-w-sm">
      <div className="grid grid-cols-8 border border-cb-border-strong">
        {board.map((row, rankIndex) =>
          row.map((piece, fileIndex) => {
            const isLight = (rankIndex + fileIndex) % 2 === 0;
            const square = `${FILES[fileIndex]}${8 - rankIndex}`;
            return (
              <div
                key={square}
                className={`relative aspect-square ${
                  isLight ? "bg-neutral-100" : "bg-neutral-800"
                }`}
              >
                {piece && (
                  <Image
                    src={`/chess-icons/${piece.color}${piece.type}.png`}
                    alt={`${piece.color === "w" ? "White" : "Black"} ${PIECE_NAMES[piece.type]} on ${square}`}
                    fill
                    sizes="48px"
                    className="object-contain p-[6%]"
                  />
                )}
              </div>
            );
          }),
        )}
      </div>
      {caption && (
        <figcaption className="mt-3 text-center font-sans text-[10px] uppercase tracking-[0.2em] text-cb-text-faint">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
