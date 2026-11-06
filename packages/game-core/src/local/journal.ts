// Bot-game journal (plan 5.3.2): localStorage["rc:bot:<ref>"] after every move, ~1 KB. `rev` is monotonic and
// increments on undo too, so a checkpoint carrying an undo is never shadowed by an older, longer line.

import { BOT_JOURNAL_PREFIX } from "../constants";
import type { EndMethod } from "../machine/types";

export interface CompleteBody {
  rev: number;
  moves: string[];
  clocksMs: number[];
  result: "w" | "b" | "draw" | "aborted";
  method: EndMethod;
  assists: { hints: number; undos: number };
  endedAtClient: number;
}

export interface BotJournal {
  v: 1;
  rev: number;
  moves: string[];
  clocksMs: number[];
  startedAt: number;
  assists: { hints: number; undos: number };
  updatedAt: number;
  /** Set when `complete` failed after its retries; flushed by the pending-completes queue. */
  pendingComplete?: CompleteBody;
}

export function journalKey(ref: string): string {
  return `${BOT_JOURNAL_PREFIX}${ref}`;
}

export function serializeJournal(j: BotJournal): string {
  return JSON.stringify(j);
}

const isIntArray = (x: unknown): x is number[] => Array.isArray(x) && x.every((n) => Number.isInteger(n));
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/** Parses and validates a stored journal; anything malformed reads as null (the server snapshot is used). */
export function parseJournal(raw: string | null | undefined): BotJournal | null {
  if (!raw) return null;
  let x: unknown;
  try {
    x = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!x || typeof x !== "object") return null;
  const j = x as Record<string, unknown>;
  if (j.v !== 1 || !Number.isInteger(j.rev) || (j.rev as number) < 0) return null;
  if (!Array.isArray(j.moves) || !j.moves.every((m) => typeof m === "string" && UCI.test(m))) return null;
  if (!isIntArray(j.clocksMs)) return null;
  if (typeof j.startedAt !== "number" || typeof j.updatedAt !== "number") return null;
  const a = j.assists as Record<string, unknown> | undefined;
  if (!a || !Number.isInteger(a.hints) || !Number.isInteger(a.undos)) return null;
  const out: BotJournal = {
    v: 1,
    rev: j.rev as number,
    moves: j.moves as string[],
    clocksMs: j.clocksMs,
    startedAt: j.startedAt,
    assists: { hints: a.hints as number, undos: a.undos as number },
    updatedAt: j.updatedAt,
  };
  if (j.pendingComplete && typeof j.pendingComplete === "object")
    out.pendingComplete = j.pendingComplete as CompleteBody;
  return out;
}

/** Resume order (plan 5.3.2): the journal if its rev is newer than the server snapshot's, else the snapshot. */
export function chooseResume(journal: BotJournal | null, snapshotRev: number): "journal" | "snapshot" {
  return journal && journal.rev > snapshotRev ? "journal" : "snapshot";
}
