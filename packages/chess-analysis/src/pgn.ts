// The annotated PGN (phase-03 plan §8.15, P3-D18): Download PGN, Copy PGN with Comments and A8 all use this one
// builder. It reads the review payload (ReviewDTO fits `AnnotatedPgnInput` as is), so the browser builds the file
// without another request.
//
// Headers: Event "Replay Chess game", Site, Date (yyyy.mm.dd), White, Black, Result, TimeControl ("600+5", "-" when
// untimed), ECO and Opening when known, SetUp "1" + FEN for a game that did not start from the initial position,
// Annotator "Replay Chess · Stockfish 18 (sf18-v1)".
//
// Per ply: the SAN, then a NAG by judgement ($3 brilliant, $1 great, $5 interesting, $6 inaccuracy, $2 mistake,
// $4 blunder; a miss is $2 with the comment "Miss"), then one comment holding `[%eval 0.36]` (the eval after the
// ply, White POV, pawns with two decimals; `#3` / `#-3` for a mate; omitted on the final checkmate and for plies not
// graded yet), `[%clk 0:04:12]` (the mover's clock after the ply) and, on a key-moment ply, the "why" sentences.
// Comment text never contains a brace. The result re-parses with chess.js `loadPgn`.

import { Chess } from "chess.js";
import { isInitialPosition } from "./board";
import { decodeEval, judgementFromChar, J, type JudgementCode } from "./codec";
import { ENGINE_PROFILE } from "./version";

export const PGN_EVENT = "Replay Chess game";
export const PGN_ANNOTATOR = `Replay Chess · ${ENGINE_PROFILE.engine} (${ENGINE_PROFILE.id})`;
export const PGN_DEFAULT_SITE = "https://playchess.tech";

/** NAG per judgement (MISS adds the comment "Miss"). */
export const NAG: Readonly<Partial<Record<JudgementCode, number>>> = {
  [J.BRILLIANT]: 3,
  [J.GREAT]: 1,
  [J.INTERESTING]: 5,
  [J.INACCURACY]: 6,
  [J.MISTAKE]: 2,
  [J.MISS]: 2,
  [J.BLUNDER]: 4,
};

export interface AnnotatedPgnInput {
  game: {
    startFen: string;
    startPly: number;
    result: string;
    /** ISO date-time (games."completedAt"). */
    playedAt: string;
    tc: { initialSec: number; incSec: number; timeClass?: string | null };
    opening: { eco: string; name: string } | null;
  };
  players: { w: { name: string }; b: { name: string } };
  /** UCI from startFen, space-separated. */
  moves: string;
  /** The mover's remaining ms after each ply (empty for untimed games). */
  clocks: readonly number[];
  analysis: { evals: readonly number[]; j: string } | null;
  review: { moments: readonly { ply: number; why: readonly { t: string }[] }[] } | null;
}

/**
 * A tag value every reader parses the same way. PGN escapes `"` and `\` with a backslash, but chess.js `loadPgn`
 * rejects `\"` and keeps `\\` as two characters, so the annotated PGN would not re-parse (plan §12.1) for a player
 * or opening name with a quote. Quotes become apostrophes, backslashes slashes, control characters spaces: free-form
 * display names stay readable and the tag needs no escape at all.
 */
export function tagValue(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    out += code < 0x20 || code === 0x7f ? " " : ch === "\\" ? "/" : ch === '"' ? "'" : ch;
  }
  return out;
}

function tag(name: string, value: string): string {
  return `[${name} "${tagValue(value)}"]`;
}

function commentSafe(s: string): string {
  return s.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

/** "[%eval 0.36]" / "[%eval #-3]"; null for a final checkmate (mate in 0). */
export function evalTag(stored: number): string | null {
  const d = decodeEval(stored);
  if (d.kind === "cp") return `[%eval ${(d.cp / 100).toFixed(2)}]`;
  if (d.moves === 0) return null;
  return `[%eval #${d.winner === "w" ? "" : "-"}${d.moves}]`;
}

/** "[%clk 0:04:12]" from milliseconds (whole seconds, rounded down). */
export function clockTag(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `[%clk ${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}]`;
}

function dateTag(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "????.??.??";
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Builds the annotated PGN text. Throws a RangeError when a move does not replay. */
export function buildAnnotatedPgn(review: AnnotatedPgnInput, opts: { site?: string } = {}): string {
  const g = review.game;
  const initial = isInitialPosition(g.startFen);
  const timed = g.tc.initialSec > 0 || g.tc.incSec > 0;
  const headers = [
    tag("Event", PGN_EVENT),
    tag("Site", opts.site ?? PGN_DEFAULT_SITE),
    tag("Date", dateTag(g.playedAt)),
    tag("White", review.players.w.name),
    tag("Black", review.players.b.name),
    tag("Result", g.result),
    tag("TimeControl", timed ? `${g.tc.initialSec}+${g.tc.incSec}` : "-"),
  ];
  if (g.opening) headers.push(tag("ECO", g.opening.eco), tag("Opening", g.opening.name));
  if (!initial) headers.push(tag("SetUp", "1"), tag("FEN", g.startFen));
  headers.push(tag("Annotator", PGN_ANNOTATOR));

  const why = new Map<number, string>();
  for (const m of review.review?.moments ?? []) why.set(m.ply, m.why.map((s) => s.t).join(" "));
  const evals = review.analysis?.evals ?? [];
  const j = review.analysis?.j ?? "";

  const chess = new Chess(g.startFen);
  const tokens: string[] = [];
  const uci = review.moves === "" ? [] : review.moves.split(" ");
  let afterComment = false;
  uci.forEach((m, i) => {
    const white = chess.turn() === "w";
    const moveNumber = Number(chess.fen().split(" ")[5]);
    let move;
    try {
      move = chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    } catch {
      throw new RangeError(`move ${i} (${m}) does not replay`);
    }
    const code = i < j.length ? judgementFromChar(j[i] as string) : J.UNGRADED;
    const nag = NAG[code];
    // The move number, the SAN and the NAG stay together on one line.
    const number = white ? `${moveNumber}. ` : i === 0 || afterComment ? `${moveNumber}... ` : "";
    tokens.push(`${number}${move.san}${nag === undefined ? "" : ` $${nag}`}`);
    const parts: string[] = [];
    const graded = code !== J.UNGRADED && evals[i + 1] !== undefined;
    if (graded) {
      const e = evalTag(evals[i + 1] as number);
      if (e) parts.push(e);
    }
    const clk = review.clocks[i];
    if (clk !== undefined) parts.push(clockTag(clk));
    if (code === J.MISS) parts.push("Miss.");
    const w = why.get(i);
    if (w) parts.push(commentSafe(w));
    if (parts.length) tokens.push(`{${parts.join(" ")}}`);
    // After a comment, Black's move needs its number again ("12... Nf6").
    afterComment = parts.length > 0;
  });
  tokens.push(g.result);

  const lines: string[] = [];
  let line = "";
  for (const t of tokens) {
    if (line.length + t.length + 1 > 80 && line !== "") {
      lines.push(line);
      line = t;
    } else line = line === "" ? t : `${line} ${t}`;
  }
  if (line) lines.push(line);
  return `${headers.join("\n")}\n\n${lines.join("\n")}\n`;
}
