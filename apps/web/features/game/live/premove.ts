// Premove helpers (P2 plan 5.2.5, 8.18). The premove itself (one queued move, fired in the same task as the
// opponent's `move:applied` when legal, else cancelled) lives in the game-core client reducer; the board needs the
// pseudo-legal targets, which come from game-core's `premoveDests` (blockers ignored, own-piece recaptures
// allowed). Results are cached per FEN so the board's `premoveDests(from)` callback is O(1) on repeat.

import { legalDests, peekChess, premoveDests as premoveMap } from "@repo/game-core/rules/chess";
import type { Side } from "@repo/game-core/machine/types";
import type { Sq } from "@/components/board/types";

type DestMap = Map<string, string[]>;

const CACHE_MAX = 64;
const legalCache = new Map<string, DestMap>();
const premoveCache = new Map<string, DestMap>();

function remember(cache: Map<string, DestMap>, key: string, value: DestMap): DestMap {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}

/** Legal targets per from-square for the side to move in `fen`. */
export function legalDestsFor(fen: string): DestMap {
  const hit = legalCache.get(fen);
  if (hit) return hit;
  return remember(legalCache, fen, legalDests(peekChess(fen, [])) as unknown as DestMap);
}

/** Premove targets for `side` (the side NOT to move) in `fen`. */
export function premoveDestsFor(fen: string, side: Side): DestMap {
  const key = `${side} ${fen}`;
  const hit = premoveCache.get(key);
  if (hit) return hit;
  return remember(premoveCache, key, premoveMap(fen, side) as unknown as DestMap);
}

export function destsCallback(map: DestMap): (from: Sq) => Sq[] {
  return (from) => (map.get(from) ?? []) as Sq[];
}
