// Shared chess for both mappers: replay a SAN list from a start FEN with chess.js (the moves become P2's UCI string
// and the final FEN), read Chess.com PGN movetext with its `%clk` comments, and spot the board-provable draws.
// Everything is pure; an illegal or malformed move makes the game a `parse_error` (§8.6 step 5), never half-stored.
import { Chess } from "chess.js";
import { INITIAL_FEN } from "@repo/game-core/constants";
import { isValidFen, startPlyOf, toUci } from "@repo/game-core/rules/chess";

export { INITIAL_FEN };

export interface Replayed {
  /** UCI moves, one per ply. */
  uci: string[];
  plyCount: number;
  startPly: number;
  startingFen: string;
  fen: string;
  /** The board after the last ply, rebuilt by replay so threefold sees the whole history. */
  chess: Chess;
  /** Index of every ply that is an en passant capture / a castle / a promotion (fixture coverage checks). */
  flags: { enPassant: number; castleKing: number; castleQueen: number; promotions: string[] };
}

export type ReplayOutcome = { ok: true; game: Replayed } | { ok: false; detail: string };

/** Strips move-quality suffixes ("e4!?", "Nf3?!") that some PGN writers add; chess.js wants bare SAN. */
const cleanSan = (san: string): string => san.replace(/[!?]+$/, "");

export function replaySan(startingFen: string, sans: readonly string[]): ReplayOutcome {
  if (!isValidFen(startingFen)) return { ok: false, detail: "invalid start FEN" };
  const chess = new Chess(startingFen);
  const uci: string[] = [];
  const flags: Replayed["flags"] = { enPassant: 0, castleKing: 0, castleQueen: 0, promotions: [] };
  for (let i = 0; i < sans.length; i++) {
    const san = cleanSan(sans[i]!);
    let mv;
    try {
      mv = chess.move(san);
    } catch {
      return { ok: false, detail: `illegal move "${san}" at ply ${i + 1}` };
    }
    uci.push(toUci(mv));
    if (mv.isEnPassant()) flags.enPassant += 1;
    if (mv.isKingsideCastle()) flags.castleKing += 1;
    if (mv.isQueensideCastle()) flags.castleQueen += 1;
    if (mv.promotion) flags.promotions.push(mv.promotion);
  }
  return {
    ok: true,
    game: {
      uci,
      plyCount: uci.length,
      startPly: startPlyOf(startingFen),
      startingFen,
      fen: chess.fen(),
      chess,
      flags,
    },
  };
}

/** Placement, side to move and castling: what decides "the same position" for the archive check (§8.6). */
export function positionKey(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 3).join(" ");
}

export interface PgnMovetext {
  headers: Record<string, string>;
  sans: string[];
  /** `%clk` per SAN in ms; null where a move has none. */
  clocks: (number | null)[];
}

const HEADER_RE = /^\s*\[([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/;
const RESULT_TOKENS = new Set(["1-0", "0-1", "1/2-1/2", "*"]);

/** `%clk 1:02:03.4` → ms; tenths optional (`0:00:59`). Null when the comment has no clock. */
export function clkToMs(comment: string): number | null {
  const m = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/.exec(comment);
  if (!m) return null;
  const frac = m[4] ? Math.round(Number(`0.${m[4]}`) * 1000) : 0;
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + frac;
}

/**
 * Splits a PGN (one game) into headers, SAN moves and their `%clk` values. Comments, NAGs and move numbers are
 * dropped; a variation `( … )` or text that is not SAN makes it fail (Chess.com archives carry neither).
 */
export function parsePgn(pgn: string): { ok: true; value: PgnMovetext } | { ok: false; detail: string } {
  const headers: Record<string, string> = {};
  const lines = pgn.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") {
      if (Object.keys(headers).length > 0) {
        i++;
        break;
      }
      continue;
    }
    const m = HEADER_RE.exec(line);
    if (!m) break;
    headers[m[1]!] = m[2]!.replace(/\\(["\\])/g, "$1");
  }
  const text = lines.slice(i).join("\n");
  const sans: string[] = [];
  const clocks: (number | null)[] = [];
  const TOKEN = /\{([^}]*)\}|;[^\n]*|\$\d+|(\d+)\.(?:\.\.)?|([^\s{};$]+)/g;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(text))) {
    if (m[1] !== undefined) {
      if (sans.length > 0 && clocks[sans.length - 1] === null) clocks[sans.length - 1] = clkToMs(m[1]);
      continue;
    }
    if (m[2] !== undefined) continue; // move number
    const tok = m[3];
    if (tok === undefined) continue; // `;` comment or NAG
    if (RESULT_TOKENS.has(tok)) continue;
    if (tok.startsWith("(") || tok.startsWith(")")) return { ok: false, detail: "PGN variations are not supported" };
    // "12...Nf6" written without a space after the dots
    const glued = /^\d+\.(?:\.\.)?(.+)$/.exec(tok);
    const san = glued ? glued[1]! : tok;
    if (!/^(?:[NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=?[NBRQ])?|O-O(?:-O)?|0-0(?:-0)?)[+#]?[!?]*$/.test(san))
      return { ok: false, detail: `not a SAN move: "${san.slice(0, 12)}"` };
    sans.push(san.replace(/^0-0-0/, "O-O-O").replace(/^0-0/, "O-O"));
    clocks.push(null);
  }
  return { ok: true, value: { headers, sans, clocks } };
}

export type BoardDraw = "STALEMATE" | "INSUFFICIENT_MATERIAL" | "THREEFOLD" | "FIFTY_MOVE";

/**
 * The draw a replayed final position proves, in game-core's `detectEnd` order (stalemate, insufficient material,
 * threefold, fifty-move); null when the board shows none. Used to label Lichess `draw` games (data-model B1).
 */
export function boardDraw(chess: Chess): BoardDraw | null {
  if (chess.isStalemate()) return "STALEMATE";
  if (chess.isInsufficientMaterial()) return "INSUFFICIENT_MATERIAL";
  if (chess.isThreefoldRepetition()) return "THREEFOLD";
  if (chess.isDrawByFiftyMoves()) return "FIFTY_MOVE";
  return null;
}

/** Mover of ply `i` (0-based) for a game whose start position has `startPly` plies before it. */
export const moverOf = (startPly: number, i: number): "w" | "b" => ((startPly + i) % 2 === 0 ? "w" : "b");

/** Last clock (ms) each side shows in `clocks` (one per ply), or null for a side without one. */
export function lastClocks(startPly: number, clocks: readonly number[]): { w: number | null; b: number | null } {
  const out: { w: number | null; b: number | null } = { w: null, b: null };
  for (let i = clocks.length - 1; i >= 0 && (out.w === null || out.b === null); i--) {
    const side = moverOf(startPly, i);
    if (out[side] === null) out[side] = clocks[i]!;
  }
  return out;
}
