/**
 * Ghost (P2 plan §4.5.1): a premove or a move queued while reconnecting, drawn
 * as a dashed amber outline and the piece at 50 % (V3Game `.ghost`). It is a
 * span with a background image, so the cell keeps exactly one <img>.
 */
import { pieceSrc } from "./PieceLayer";
import type { PieceCode } from "./types";

export function Ghost({ piece }: { piece: PieceCode }) {
  return (
    <span aria-hidden="true" className="rc-bd-ghost" data-mark="ghost" data-piece={piece}>
      <span style={{ backgroundImage: `url(${pieceSrc(piece)})` }} />
    </span>
  );
}
