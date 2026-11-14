// The pure half of W2 from the hub and the bank (useStartSession.ts): where a created session runs, and which
// `Idempotency-Key` a click sends (api §2.8: one UUID v4 per intent, reused for 10 s of repeated clicks with the same
// body, so a double click or a retry after a lost response returns the same session).
import type { SessionPayload } from "@repo/contracts/http/train";

/** A repeated click within this window reuses the key (same body). */
export const IDEMPOTENCY_REUSE_MS = 10_000;

/** Where the runner for a created session lives: puzzle sessions run on /train/puzzles, the rest on the bank runner. */
export function runnerHref(payload: Pick<SessionPayload, "ref" | "kind">): string {
  const base = payload.kind === "puzzles" ? "/train/puzzles" : "/train/bank/session";
  return `${base}?s=${encodeURIComponent(payload.ref)}`;
}

export type KeyState = { key: string; body: string; at: number };

function newKey(): string {
  return globalThis.crypto.randomUUID();
}

/** The key to send: the previous one when the same body is sent again within the window, else a fresh one. */
export function keyFor(prev: KeyState | null, body: string, nowMs: number, make: () => string = newKey): KeyState {
  if (prev && prev.body === body && nowMs - prev.at < IDEMPOTENCY_REUSE_MS) return prev;
  return { key: make(), body, at: nowMs };
}
