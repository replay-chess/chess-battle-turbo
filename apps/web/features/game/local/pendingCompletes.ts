"use client";

// The pending-complete queue (phase-02 plan 5.3.3). When `POST /api/games/<ref>/complete` still fails after its
// retries (1 s, 4 s, 15 s on network errors and 5xx), the bot journal keeps `{ pendingComplete: body }`.
// `useFlushPendingBotCompletes()` (mounted once in the (app) layout through <PendingBotCompletes />) sends them on
// the next app load and on every `online` event:
// - 200 (or an idempotent replay) → the journal is removed;
// - a final refusal (403, 404, 409 already completed, 422 illegal moves) → the journal is removed (it can never
//   be saved; the 422 is already reported by the game page);
// - anything else (offline, 5xx, 402, 429) → kept for the next flush.
// Journals with no pending complete that were not touched for STALE_BOT_DAYS are removed too (the server's stale
// sweep has aborted those games). A game page that is completing its own game marks the ref in flight, so the
// queue never sends the same body twice at once.

import { useEffect } from "react";
import type { CompleteBody, CompleteResponse } from "@repo/contracts/http/games";
import { STALE_BOT_DAYS } from "@repo/game-core/constants";
import { completeBotGameRequest } from "@/lib/api/mutations/games";
import { ApiError } from "@/lib/api/errors";
import { deviceStorage, listJournals, removeJournal, type KeyValueStore } from "./persist";

const inFlight = new Set<string>();

/** The game page marks its own complete while it runs; returns the unmark. */
export function markCompleteInFlight(ref: string): () => void {
  inFlight.add(ref);
  return () => inFlight.delete(ref);
}

export function isCompleteInFlight(ref: string): boolean {
  return inFlight.has(ref);
}

const FINAL_STATUSES = new Set([403, 404, 409, 422]);

/** True when retrying the same body can never succeed. */
export function isFinalCompleteError(err: unknown): boolean {
  return err instanceof ApiError && FINAL_STATUSES.has(err.status);
}

export interface FlushDeps {
  store: KeyValueStore | null;
  complete(ref: string, body: CompleteBody): Promise<CompleteResponse>;
  now(): number;
}

export interface FlushResult {
  sent: string[];
  dropped: string[];
  kept: string[];
  pruned: string[];
}

const defaultDeps = (): FlushDeps => ({
  store: deviceStorage(),
  // One attempt per flush: the next load or `online` event is the retry.
  complete: (ref, body) => completeBotGameRequest(ref, body, []),
  now: () => Date.now(),
});

let running: Promise<FlushResult> | null = null;

export async function flushPendingBotCompletes(deps: FlushDeps = defaultDeps()): Promise<FlushResult> {
  const result: FlushResult = { sent: [], dropped: [], kept: [], pruned: [] };
  const staleBefore = deps.now() - STALE_BOT_DAYS * 24 * 60 * 60 * 1000;
  for (const { ref, journal } of listJournals(deps.store)) {
    if (!journal) {
      removeJournal(ref, deps.store);
      result.pruned.push(ref);
      continue;
    }
    if (!journal.pendingComplete) {
      if (journal.updatedAt < staleBefore) {
        removeJournal(ref, deps.store);
        result.pruned.push(ref);
      }
      continue;
    }
    if (inFlight.has(ref)) {
      result.kept.push(ref);
      continue;
    }
    const unmark = markCompleteInFlight(ref);
    try {
      await deps.complete(ref, journal.pendingComplete as CompleteBody);
      removeJournal(ref, deps.store);
      result.sent.push(ref);
    } catch (err) {
      if (isFinalCompleteError(err)) {
        removeJournal(ref, deps.store);
        result.dropped.push(ref);
      } else result.kept.push(ref);
    } finally {
      unmark();
    }
  }
  return result;
}

/** One flush at a time per tab. */
function flushOnce(): Promise<FlushResult> {
  running ??= flushPendingBotCompletes().finally(() => {
    running = null;
  });
  return running;
}

/** Flushes on mount and on every `online` event. Mount once, in the (app) layout. */
export function useFlushPendingBotCompletes(): void {
  useEffect(() => {
    void flushOnce().catch(() => {});
    const onOnline = () => void flushOnce().catch(() => {});
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);
}

/** `<PendingBotCompletes />` for the (app) layout (a server component cannot call the hook). Renders nothing. */
export function PendingBotCompletes(): null {
  useFlushPendingBotCompletes();
  return null;
}
