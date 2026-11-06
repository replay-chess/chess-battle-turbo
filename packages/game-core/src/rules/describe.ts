// Small descriptive rules (plan 8.19, 4.8): the selection hint, header lines and material names.

import type { Chess, Square } from "chess.js";
import type { GameMode, Side } from "../machine/types";
import { parsePlacement } from "./chess";
import { timeLabel, tcLabel, type TimeControlSeconds } from "./timeClass";

/** "King selected · castling long is legal" (or "short" / "both ways") when the selected king can castle now. */
export function selectionHint(chess: Chess, square: Square): string | null {
  const piece = chess.get(square);
  if (!piece || piece.type !== "k" || piece.color !== chess.turn()) return null;
  const moves = chess.moves({ verbose: true, square });
  const short = moves.some((m) => m.isKingsideCastle());
  const long = moves.some((m) => m.isQueensideCastle());
  if (short && long) return "King selected · castling both ways is legal";
  if (long) return "King selected · castling long is legal";
  if (short) return "King selected · castling short is legal";
  return null;
}

export type HeaderSource =
  | { kind: "initial" }
  | { kind: "legend"; eco?: string | null; opening?: string | null; white: string; black: string; year?: number | null }
  | { kind: "opening"; eco?: string | null; name: string }
  | { kind: "position"; title: string }
  | { kind: "endgame"; moveNo: number };

/** Left header (plan 8.19). Computed once at creation and stored in `meta.header`. */
export function headerLeft(src: HeaderSource): string {
  switch (src.kind) {
    case "initial":
      return "";
    case "legend": {
      const parts = [src.eco, src.opening].filter((x): x is string => !!x);
      const who = `${src.white} vs ${src.black}${src.year ? ` ${src.year}` : ""}`;
      return [...parts, who].join(" · ");
    }
    case "opening":
      return [src.eco, src.name].filter((x): x is string => !!x).join(" · ");
    case "position":
      return src.title;
    case "endgame":
      return `Endgame · move ${src.moveNo}`;
  }
}

/** Right header (plan 4.8 copy): no ratings until P9, so live games say "unrated". */
export function headerRight(opts: {
  mode: GameMode;
  tc: TimeControlSeconds | null;
  role: "player" | "spectator";
  rematch?: boolean;
  botElo?: number | null;
}): string {
  if (opts.mode === "BOT") return `vs Engine ${opts.botElo ?? ""} · unrated`.replace("  ", " ");
  const label = timeLabel(opts.tc);
  if (opts.role === "spectator") return `Watching · ${label}`;
  if (opts.rematch) return `Rematch · ${label}`;
  if (opts.mode === "FRIEND") return `Friend game · ${tcLabel(opts.tc) || "untimed"}`;
  return `${label} · unrated`;
}

const NAMES = { n: "knight", b: "bishop", r: "rook", q: "queen", p: "pawn" } as const;

/** Names the material for `over_insufficient` ("Only kings left", "King and knight vs king", …). */
export function describeMaterial(fen: string): string {
  const sides: Record<Side, string[]> = { w: [], b: [] };
  for (const p of parsePlacement(fen).values()) if (p.type !== "k") sides[p.color].push(NAMES[p.type]);
  const name = (list: string[]) => (list.length ? `king and ${list.sort().join(" and ")}` : "king");
  if (!sides.w.length && !sides.b.length) return "Only kings left";
  // Put the side with material first so the line reads "King and bishop vs king".
  const [a, b] = sides.w.length >= sides.b.length ? [sides.w, sides.b] : [sides.b, sides.w];
  const text = `${name(a)} vs ${name(b)}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Initials for a player chip ("martin_k" → "MK", "knightowl_88" → "KN"; digits are skipped). */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/[\s_.-]+/)
    .filter((w) => /\p{L}/u.test(w));
  if (words.length >= 2) return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}
