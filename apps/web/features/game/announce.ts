// Screen-reader announcements for the game (P2 plan 4.4 `LiveRegions`, WCAG 4.1.3). Pure: `announce(prev, next)`
// compares two client stores and returns what the polite region (moves, connection) and the assertive region
// (a move that checks the viewer, the opponent disconnecting, game over) should say. The offer bars carry
// role="alert" and the in-panel toast is a polite live region already, so offers and toasts are not repeated here.
// The ten-second warning comes from the clock store (useLowTimeAlert).

import type { ClientGame } from "@repo/game-core/client/reducer";
import { deriveViewState } from "@repo/game-core/client/viewState";
import { applyUci, splitMoves } from "@repo/game-core/rules/chess";
import type { Side } from "@repo/game-core/machine/types";
import { Chess } from "chess.js";
import { colorName, copyCtx, resultCopy } from "./copy";

const PIECE: Record<string, string> = { K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight" };

/** "Nxf3+" → "knight takes f3, check"; "O-O-O" → "castles queenside"; "e8=Q#" → "e8 promotes to queen, checkmate". */
export function speakSan(san: string): string {
  const mate = san.includes("#");
  const check = !mate && san.includes("+");
  const core = san.replace(/[+#!?]/g, "");
  let words: string;
  if (core === "O-O-O" || core === "0-0-0") words = "castles queenside";
  else if (core === "O-O" || core === "0-0") words = "castles kingside";
  else {
    const m = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=([QRBN]))?$/.exec(core);
    if (!m) words = core;
    else {
      const [, piece, file, rank, takes, to, promo] = m;
      const from = `${file ?? ""}${rank ?? ""}`;
      const head = piece ? `${PIECE[piece]}${from ? ` ${from}` : ""}` : from; // pawn captures name their file
      const verb = takes ? `${head ? `${head} ` : ""}takes ${to}` : `${head ? `${head} ` : ""}${to}`;
      words = promo ? `${verb} promotes to ${PIECE[promo]}` : verb;
    }
  }
  return mate ? `${words}, checkmate` : check ? `${words}, check` : words;
}

export interface Announcement {
  polite?: string;
  assertive?: string;
}

const seatOf = (g: ClientGame): Side | null => (g.state.you.role === "player" ? (g.state.you.color ?? null) : null);

function newMoves(prev: ClientGame, next: ClientGame): { side: Side; san: string }[] {
  const before = splitMoves(prev.state.moves);
  const after = splitMoves(next.state.moves);
  if (after.length <= before.length || after.length - before.length > 2) return [];
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) return [];
  let chess: Chess;
  try {
    chess = new Chess(prev.state.fen);
  } catch {
    return [];
  }
  const out: { side: Side; san: string }[] = [];
  for (const uci of after.slice(before.length)) {
    const side = chess.turn() as Side;
    const mv = applyUci(chess, uci);
    if (!mv) break;
    out.push({ side, san: mv.san });
  }
  return out;
}

/** `serverNow` derives the result at game end (the method line names the move). */
export function announce(prev: ClientGame, next: ClientGame, serverNow: number): Announcement {
  if (prev === next || prev.state.ref !== next.state.ref) return {};
  const me = seatOf(next);
  const ctx = copyCtx(next.state);
  const names = ctx.names;
  const out: Announcement = {};

  const moves = prev.joined ? newMoves(prev, next) : [];
  const said = moves.map((m) => `${me && m.side === me ? "You" : names[m.side] || colorName(m.side)}: ${speakSan(m.san)}.`);
  if (said.length) {
    const checksMe = me !== null && next.state.inCheck && next.state.turn === me && moves.at(-1)?.side !== me;
    if (checksMe) out.assertive = said.join(" ");
    else out.polite = said.join(" ");
  }

  if (prev.state.phase !== "ended" && next.state.phase === "ended") {
    const r = deriveViewState(next, serverNow).result;
    if (r) {
      const text = resultCopy(r, ctx, next.state);
      const head = r.spectator ? "" : `${text.kindLabel}. `;
      out.assertive = [out.assertive, `Game over. ${head}${text.title}. ${text.method}.`].filter(Boolean).join(" ");
    }
    return out;
  }

  if (me) {
    const opp: Side = me === "w" ? "b" : "w";
    if (prev.joined && prev.state.players[opp].online && !next.state.players[opp].online) {
      out.assertive = [out.assertive, `${names[opp]} disconnected.`].filter(Boolean).join(" ");
    }
  }

  const wasDown = prev.conn === "reconnecting" || prev.conn === "offline";
  const isDown = next.conn === "reconnecting" || next.conn === "offline";
  if (!wasDown && isDown && prev.joined) out.polite = [out.polite, "Connection lost. Reconnecting."].filter(Boolean).join(" ");
  return out;
}

export const LOW_TIME_ANNOUNCEMENT = "Ten seconds left on your clock.";
