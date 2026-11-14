// Local move checking for the trainer (phase-05 plan §5.2 "Move check", §4.4 "broken item"): every item of a session
// payload is replayed once with chess.js when it is first needed (setup move, the solution line, the accepted
// alternatives), so a move is judged in the browser with no network (≤ 16 ms move → verdict, §9.6). An item whose stored
// line does not replay legally is "broken": the runner skips it, files a report and toasts once.
//
//   judgeMove(p, ply, uci): "best"   = the stored solution ply (promotions compare with their piece, 5-char UCI)
//                           "accept" = an accepted alternative of the first user move (review positions, extra mates),
//                                      or ANY checkmate where the stored move mates, at any ply (a Lichess puzzle's
//                                      other mate, the last ply of a longer line: plan §8.1 step 2, FIX-1 alt-mate):
//                                      it solves the item
//                           "wrong"  = any other legal move
// No React and no zod: the runner chunk stays small (§9.5).
import { Chess, type Square } from "chess.js";
import type { TrainItem } from "@repo/contracts/http/train";
import { givesMate } from "@repo/chess-training/mates";

export type Side = "w" | "b";

export type PlyMove = {
  uci: string;
  from: Square;
  to: Square;
  san: string;
  /** The position after this move. */
  fen: string;
  /** The king in check after this move, if any. */
  check: Square | null;
};

export type PreparedItem = {
  itemId: string;
  /** `item.fen` (puzzles: before the setup move). */
  startFen: string;
  /** The opponent's setup move (puzzles), auto-played after 400 ms. */
  setup: PlyMove | null;
  /** The position the member solves (after the setup). */
  baseFen: string;
  /** The solution plies from `baseFen`: user, reply, user, … */
  line: PlyMove[];
  /** Legal accepted alternatives for the first user move (lowercase UCI). */
  accept: ReadonlySet<string>;
  /** Solution plies whose stored move gives checkmate: any other mating move solves the item there. */
  matePlies: ReadonlySet<number>;
  /** The side the member plays (to move at `baseFen`). */
  userSide: Side;
};

export function normUci(uci: string): string {
  return uci.trim().toLowerCase();
}

/** Plays one UCI move on a position, or null when it is illegal or unreadable. */
export function playUci(fen: string, uci: string): PlyMove | null {
  const u = normUci(uci);
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u)) return null;
  try {
    const chess = new Chess(fen);
    const m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length === 5 ? u[4] : undefined });
    if (!m) return null;
    // chess.js accepts "e7e8" without a piece only for non-promotions; a promotion needs its piece in the UCI.
    if (m.promotion && u.length !== 5) return null;
    return { uci: u, from: m.from, to: m.to, san: m.san, fen: chess.fen(), check: kingInCheck(chess) };
  } catch {
    return null;
  }
}

function kingInCheck(chess: Chess): Square | null {
  if (!chess.inCheck()) return null;
  const turn = chess.turn();
  for (const row of chess.board()) {
    for (const sq of row) if (sq && sq.type === "k" && sq.color === turn) return sq.square;
  }
  return null;
}

/** The king in check in a position (the board's `check` mark). */
export function checkSquareOf(fen: string): Square | null {
  try {
    return kingInCheck(new Chess(fen));
  } catch {
    return null;
  }
}

export function sideToMove(fen: string): Side {
  return fen.split(" ")[1] === "b" ? "b" : "w";
}

/** Replays an item; null = broken (an illegal setup or solution ply, or an unreadable FEN). */
export function prepareItem(item: Pick<TrainItem, "itemId" | "fen" | "setup" | "solution" | "accept">): PreparedItem | null {
  try {
    new Chess(item.fen);
  } catch {
    return null;
  }
  let fen = item.fen;
  let setup: PlyMove | null = null;
  if (item.setup.length > 0) {
    setup = playUci(fen, item.setup[0]!);
    if (!setup) return null;
    fen = setup.fen;
  }
  const baseFen = fen;
  const line: PlyMove[] = [];
  for (const uci of item.solution) {
    const m = playUci(fen, uci);
    if (!m) return null;
    line.push(m);
    fen = m.fen;
  }
  if (!line.length) return null;
  const accept = new Set<string>();
  for (const a of item.accept) {
    const u = normUci(a);
    if (u !== line[0]!.uci && playUci(baseFen, u)) accept.add(u);
  }
  const matePlies = new Set<number>();
  for (let i = 0; i < line.length; i += 2) if (isMateFen(line[i]!.fen)) matePlies.add(i);
  return { itemId: item.itemId, startFen: item.fen, setup, baseFen, line, accept, matePlies, userSide: sideToMove(baseFen) };
}

function isMateFen(fen: string): boolean {
  try {
    return new Chess(fen).isCheckmate();
  } catch {
    return false;
  }
}

export type Verdict = "best" | "accept" | "wrong";

/** Judges the member's move at solution ply `ply` (an even index: the member's turn). */
export function judgeMove(p: PreparedItem, ply: number, uci: string): Verdict {
  const u = normUci(uci);
  const expected = p.line[ply];
  if (!expected) return "wrong";
  if (u === expected.uci) return "best";
  if (ply === 0 && p.accept.has(u)) return "accept";
  if (p.matePlies.has(ply) && givesMate(fenBefore(p, ply), u)) return "accept";
  return "wrong";
}

/** The position before solution ply `ply` (0 = the base position). */
export function fenBefore(p: PreparedItem, ply: number): string {
  return ply <= 0 ? p.baseFen : (p.line[Math.min(ply, p.line.length) - 1]?.fen ?? p.baseFen);
}

/** The last move on the board before solution ply `ply`: the previous line ply, else the setup move. */
export function lastMoveBefore(p: PreparedItem, ply: number): PlyMove | null {
  if (ply > 0) return p.line[Math.min(ply, p.line.length) - 1] ?? null;
  return p.setup;
}

const destsMemo = new Map<string, Map<string, Square[]>>();

/** Legal targets per square for the board's `dests` (memoised for the few positions of a session). */
export function destsOf(fen: string): Map<string, Square[]> {
  const hit = destsMemo.get(fen);
  if (hit) return hit;
  const out = new Map<string, Square[]>();
  try {
    for (const m of new Chess(fen).moves({ verbose: true })) {
      const list = out.get(m.from) ?? [];
      if (!list.includes(m.to)) list.push(m.to);
      out.set(m.from, list);
    }
  } catch {
    // An unreadable position takes no input.
  }
  if (destsMemo.size > 32) destsMemo.clear();
  destsMemo.set(fen, out);
  return out;
}
