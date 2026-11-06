// PGN built once at the end of a game (plan 8.12) from startFen, moves and the per-ply clocks, with %clk comments.
// Move numbering starts from the FEN's fullmove number; a Black-to-move start begins with "10...".

import { INITIAL_FEN } from "./constants";
import type { EndMethod, GameMode, Side } from "./machine/types";
import { fullmoveOf, replay, sideToMove, splitMoves } from "./rules/chess";

export interface PgnInput {
  ref: string;
  mode: GameMode;
  /** Epoch ms of the game start (Date tag, UTC). */
  date: number;
  white: string;
  black: string;
  startFen: string;
  moves: string | readonly string[];
  /** Mover's remaining ms after each ply; empty for untimed games. */
  clocksMs?: readonly number[];
  result: { winner: Side | null; method: EndMethod } | null;
  tc: { initialMs: number; incrementMs: number } | null;
  eco?: string | null;
  opening?: string | null;
  /** Only when a rating is shown (P9). */
  whiteElo?: number | null;
  blackElo?: number | null;
  siteOrigin?: string;
}

const EVENT_BY_MODE: Record<GameMode, string> = {
  BOT: "Replay Chess · Bot game",
  FRIEND: "Replay Chess · Friend game",
  ONLINE: "Replay Chess · Online game",
  TOURNAMENT: "Replay Chess · Tournament game",
};

/** "0:04:58.3": hours, minutes, seconds and floored tenths. */
export function formatClk(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 100));
  const tenths = t % 10;
  const totalS = Math.floor(t / 10);
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${tenths}`;
}

export function resultToken(result: PgnInput["result"]): "1-0" | "0-1" | "1/2-1/2" | "*" {
  if (!result || result.method === "aborted") return "*";
  if (result.winner === "w") return "1-0";
  if (result.winner === "b") return "0-1";
  return "1/2-1/2";
}

export function terminationOf(method: EndMethod | null | undefined): "Normal" | "Time forfeit" | "Abandoned" | null {
  if (!method) return null;
  if (method === "timeout" || method === "timeout_vs_insufficient") return "Time forfeit";
  if (method === "abandoned" || method === "aborted") return "Abandoned";
  return "Normal";
}

function dateTag(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
}

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Movetext units, one per ply: "10. Nxb5 {[%clk 0:04:58.3]}", "10... Nbd7 {[%clk 0:04:51.0]}", … */
export function movetextTokens(
  startFen: string,
  moves: string | readonly string[],
  clocksMs: readonly number[] = [],
): string[] {
  const r = replay(startFen, moves);
  if (!r.ok) throw new Error(`PGN: illegal move ${r.uci} at index ${r.index}`);
  const withClocks = clocksMs.length === r.sans.length && clocksMs.length > 0;
  let moveNo = fullmoveOf(startFen);
  let side = sideToMove(startFen);
  const out: string[] = [];
  let needNumber = true;
  r.sans.forEach((san, i) => {
    const parts: string[] = [];
    if (side === "w") parts.push(`${moveNo}.`);
    else if (needNumber) parts.push(`${moveNo}...`);
    parts.push(san);
    if (withClocks) parts.push(`{[%clk ${formatClk(clocksMs[i]!)}]}`);
    out.push(parts.join(" "));
    needNumber = withClocks;
    if (side === "b") moveNo++;
    side = side === "w" ? "b" : "w";
  });
  return out;
}

function wrap(tokens: string[], width = 80): string {
  const lines: string[] = [];
  let line = "";
  for (const t of tokens) {
    if (line && line.length + 1 + t.length > width) {
      lines.push(line);
      line = t;
    } else line = line ? `${line} ${t}` : t;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

export function buildPgn(input: PgnInput): string {
  const site = `${input.siteOrigin ?? "https://playchess.tech"}/game/${input.ref}`;
  const result = resultToken(input.result);
  const tags: [string, string][] = [
    ["Event", EVENT_BY_MODE[input.mode]],
    ["Site", site],
    ["Date", dateTag(input.date)],
    ["White", input.white],
    ["Black", input.black],
    ["Result", result],
    [
      "TimeControl",
      input.tc ? `${Math.round(input.tc.initialMs / 1000)}+${Math.round(input.tc.incrementMs / 1000)}` : "-",
    ],
  ];
  const term = terminationOf(input.result?.method);
  if (term) tags.push(["Termination", term]);
  if (input.startFen.trim() !== INITIAL_FEN) {
    tags.push(["SetUp", "1"], ["FEN", input.startFen]);
  }
  if (input.eco) tags.push(["ECO", input.eco]);
  if (input.opening) tags.push(["Opening", input.opening]);
  if (input.whiteElo != null) tags.push(["WhiteElo", String(input.whiteElo)]);
  if (input.blackElo != null) tags.push(["BlackElo", String(input.blackElo)]);
  const header = tags.map(([k, v]) => `[${k} "${esc(v)}"]`).join("\n");
  const tokens = movetextTokens(input.startFen, splitMoves(input.moves), input.clocksMs ?? []);
  tokens.push(result);
  return `${header}\n\n${wrap(tokens)}\n`;
}
