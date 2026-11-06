// Bot-game persistence on the device (phase-02 plan 5.3.2, 5.3.3, 6.6.7):
// - the journal `localStorage["rc:bot:<ref>"]` after every change (~1 KB; try/catch: storage may be blocked or
//   full, and the game still plays without it);
// - checkpoints to `POST /api/games/<ref>/checkpoint`: `navigator.sendBeacon` with a text/plain JSON body on
//   `pagehide` / `visibilitychange: hidden`, and `fetch(…, {keepalive: true})` every 10 plies while visible. The
//   body carries `rev` so an undo (which also bumps `rev`) is never shadowed by an older, longer line.

import { journalKey, parseJournal, serializeJournal, type BotJournal } from "@repo/game-core/local/journal";
import { BOT_JOURNAL_PREFIX } from "@repo/game-core/constants";
import type { CheckpointBody } from "@repo/contracts/http/games";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { gamePath } from "@/lib/api/queries/games";

export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key"> & { readonly length: number };

/** The tab's localStorage, or null when it is unavailable (SSR, blocked site data, some private modes). */
export function deviceStorage(): KeyValueStore | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readJournal(ref: string, store: KeyValueStore | null = deviceStorage()): BotJournal | null {
  try {
    return parseJournal(store?.getItem(journalKey(ref)));
  } catch {
    return null;
  }
}

/** Writes the journal; false when storage refused it (the game keeps going; the server checkpoints still work). */
export function writeJournal(ref: string, journal: BotJournal, store: KeyValueStore | null = deviceStorage()): boolean {
  try {
    if (!store) return false;
    store.setItem(journalKey(ref), serializeJournal(journal));
    return true;
  } catch {
    return false;
  }
}

export function removeJournal(ref: string, store: KeyValueStore | null = deviceStorage()): void {
  try {
    store?.removeItem(journalKey(ref));
  } catch {
    // nothing to clean up
  }
}

/** Every bot journal on this device: `{ ref, journal }` (unparseable entries come back with `journal: null`). */
export function listJournals(store: KeyValueStore | null = deviceStorage()): { ref: string; journal: BotJournal | null }[] {
  const out: { ref: string; journal: BotJournal | null }[] = [];
  try {
    if (!store) return out;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(BOT_JOURNAL_PREFIX)) keys.push(k);
    }
    for (const k of keys) out.push({ ref: k.slice(BOT_JOURNAL_PREFIX.length), journal: parseJournal(store.getItem(k)) });
  } catch {
    // storage became unavailable mid-scan
  }
  return out;
}

export function checkpointUrl(ref: string): string {
  return gamePath(endpoints.gameCheckpoint, ref);
}

export interface CheckpointTransport {
  beacon(url: string, body: Blob): boolean;
  fetch(url: string, body: CheckpointBody): Promise<unknown>;
}

const browserTransport: CheckpointTransport = {
  beacon(url, body) {
    try {
      return typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url, body);
    } catch {
      return false;
    }
  },
  fetch(url, body) {
    return api(url, { method: "POST", body, keepalive: true });
  },
};

/**
 * Sends one checkpoint. `beacon` (page going away): sendBeacon with a text/plain body (no preflight, survives the
 * unload), falling back to a keepalive fetch when the beacon is refused. `fetch`: a keepalive JSON POST. Never
 * throws; a lost checkpoint is covered by the next one, the journal and `complete`.
 */
export function sendCheckpoint(
  ref: string,
  body: CheckpointBody,
  mode: "beacon" | "fetch",
  transport: CheckpointTransport = browserTransport,
): void {
  const url = checkpointUrl(ref);
  if (mode === "beacon") {
    const blob = new Blob([JSON.stringify(body)], { type: "text/plain;charset=UTF-8" });
    if (transport.beacon(url, blob)) return;
  }
  try {
    void transport.fetch(url, body).catch(() => {});
  } catch {
    // keepalive quota exceeded or fetch unavailable
  }
}
