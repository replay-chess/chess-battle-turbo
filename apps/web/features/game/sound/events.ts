// Which sounds a store change plays (P2 plan 4.6.2). Pure: `soundCues(prev, next)` compares two client stores and
// returns the cues; useGameSounds plays them. Moves: move (own at full gain, the opponent's at a lower gain),
// capture, castle, check, promote; premove (set), illegal (the toast), game-start (at `playing`), game-end, and
// notify (a draw offer, a rematch offer, the opponent disconnecting). The ten-second warning is time-based and lives
// in the hook. Spectators are quiet except for game-end. A snapshot replace (join, sync, undo) plays no move sound.

import { Chess } from "chess.js";
import type { ClientGame } from "@repo/game-core/client/reducer";
import { applyUci, splitMoves } from "@repo/game-core/rules/chess";
import type { Side } from "@repo/game-core/machine/types";

export const SOUND_NAMES = [
  "move",
  "capture",
  "castle",
  "check",
  "promote",
  "premove",
  "illegal",
  "tenseconds",
  "game-start",
  "game-end",
  "notify",
] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

export interface SoundCue {
  name: SoundName;
  /** 0..1; the opponent's moves play the same files at a lower gain. */
  gain: number;
}

export const OPPONENT_GAIN = 0.7;
/** At most this many new plies get their own cue in one store change (an opponent move plus a fired premove). */
const MAX_MOVE_CUES = 2;

const seatOf = (g: ClientGame): Side | null =>
  g.state.you.role === "player" ? (g.state.you.color ?? null) : null;

/** The sound for one played move, from chess.js's move record (check wins over promotion, castle and capture). */
export function moveSound(m: { san: string; flags: string }): SoundName {
  if (m.san.includes("+") || m.san.includes("#")) return "check";
  if (m.flags.includes("p")) return "promote";
  if (m.flags.includes("k") || m.flags.includes("q")) return "castle";
  if (m.flags.includes("c") || m.flags.includes("e")) return "capture";
  return "move";
}

function newMoveCues(prev: ClientGame, next: ClientGame, me: Side | null): SoundCue[] {
  if (!next.animate || !prev.joined) return [];
  const before = splitMoves(prev.state.moves);
  const after = splitMoves(next.state.moves);
  const added = after.length - before.length;
  if (added <= 0 || added > MAX_MOVE_CUES) return [];
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) return [];
  const out: SoundCue[] = [];
  let chess: Chess;
  try {
    chess = new Chess(prev.state.fen);
  } catch {
    return [];
  }
  for (const uci of after.slice(before.length)) {
    const mover = chess.turn() as Side;
    const mv = applyUci(chess, uci);
    if (!mv) return out;
    out.push({ name: moveSound(mv), gain: mover === me ? 1 : OPPONENT_GAIN });
  }
  return out;
}

export function soundCues(prev: ClientGame, next: ClientGame): SoundCue[] {
  if (prev === next || prev.state.ref !== next.state.ref) return [];
  const s0 = prev.state;
  const s1 = next.state;
  const me = seatOf(next);
  const ended = s0.phase !== "ended" && s1.phase === "ended";
  if (ended) return [{ name: "game-end", gain: 1 }];
  if (!me) return []; // spectators: quiet except game-end

  const out: SoundCue[] = [];
  if (s0.phase !== "playing" && s1.phase === "playing" && prev.joined) out.push({ name: "game-start", gain: 1 });
  out.push(...newMoveCues(prev, next, me));

  if (!prev.premove && next.premove) out.push({ name: "premove", gain: 1 });
  if (next.toast && next.toast !== prev.toast && next.toast.code === "illegal") out.push({ name: "illegal", gain: 1 });

  const opp: Side = me === "w" ? "b" : "w";
  const drawIn = s1.drawOffer?.by === opp && s0.drawOffer?.by !== opp;
  const rematchIn = s1.rematch?.by === opp && s0.rematch?.by !== opp;
  const oppLeft = prev.joined && s0.players[opp].online && !s1.players[opp].online && s1.phase !== "ended";
  if (drawIn || rematchIn || oppLeft) out.push({ name: "notify", gain: 1 });
  return out;
}

/** Re-arms the ten-second cue once the clock is back above the threshold plus this margin (increment games). */
export const LOW_TIME_REARM_MS = 1_000;
