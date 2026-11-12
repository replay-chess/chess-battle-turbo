"use client";
// Game mutations (phase-02 plan §5.3.1, §5.3.3, §5.4).
//
// useCreateBotGame(): POST /api/games with an Idempotency-Key kept in sessionStorage per request body for 60 s
//   (`rc:idem:bot:<sha1(canonical body)>`), so a double click or a reload inside a minute reuses the key and the
//   server replays the same game instead of creating a second one. 409 in_flight → one silent retry after
//   retryAfterSec. 402 goes to /pricing through the QueryProvider; 422 and 400 are for the entry page to show inline.
// useCompleteBotGame(): POST /api/games/[ref]/complete with retries at 1 s, 4 s and 15 s on network errors and 5xx
//   (409/422 are final). The pending-complete queue (WEB/features/game/local/pendingCompletes.ts, WP-H) calls
//   completeBotGameRequest() directly. 422 illegal_moves → "This game couldn't be saved." + a Sentry message.
// useCancelLegacyChallenge(): the legacy POST /api/chess/cancel-game (until P9's /api/challenges), then /play.
import type { CompleteBody, CompleteResponse, GameCreateInput, GameCreateResponse, GameSnapshot } from "@repo/contracts/http/games";
import { CompleteResponse as CompleteResponseSchema, GameCreateResponse as GameCreateResponseSchema } from "@repo/contracts/http/games";
import { withSentry } from "@/lib/sentry/lazy";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "../client";
import { endpoints } from "../endpoints";
import { ApiError } from "../errors";
import { qk } from "../keys";
import { gamePath } from "../queries/games";

/** How long a create request reuses its Idempotency-Key (plan §5.3.1). */
export const BOT_IDEMPOTENCY_TTL_MS = 60_000;
const IDEM_PREFIX = "rc:idem:bot:";
/** Delays between complete retries (network errors and 5xx only). */
export const COMPLETE_RETRY_DELAYS_MS = [1_000, 4_000, 15_000] as const;
export const COMPLETE_SAVE_FAILED_TEXT = "This game couldn't be saved.";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** JSON with sorted keys (the same body always gives the same storage slot). */
export function canonicalBody(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalBody).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalBody(v)}`).join(",")}}`;
}

async function sha1Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-1", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // No SubtleCrypto (insecure origin): a 32-bit FNV-1a is enough for a 60 s per-tab slot.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function uuidV4(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  c?.getRandomValues?.(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type KeyStore = Pick<Storage, "getItem" | "setItem">;

function sessionStore(): KeyStore | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The Idempotency-Key for this body: reused for 60 s, then a fresh UUID v4. Never throws (storage may be blocked). */
export async function idempotencyKeyFor(body: unknown, now: number = Date.now(), store: KeyStore | null = sessionStore()): Promise<string> {
  const slot = IDEM_PREFIX + (await sha1Hex(canonicalBody(body)));
  try {
    const raw = store?.getItem(slot);
    if (raw) {
      const saved = JSON.parse(raw) as { key?: unknown; at?: unknown };
      if (typeof saved.key === "string" && typeof saved.at === "number" && now - saved.at < BOT_IDEMPOTENCY_TTL_MS) return saved.key;
    }
  } catch {
    // unreadable slot: a fresh key
  }
  const key = uuidV4();
  try {
    store?.setItem(slot, JSON.stringify({ key, at: now }));
  } catch {
    // storage full or blocked: the key still works for this request
  }
  return key;
}

/** POST /api/games once, plus one silent retry on 409 in_flight (same key). */
export async function createBotGameRequest(body: GameCreateInput, key: string): Promise<GameSnapshot> {
  const schema = process.env.NODE_ENV === "production" ? undefined : GameCreateResponseSchema;
  const send = () => api(endpoints.gameCreate, { method: "POST", body, idempotencyKey: key, schema });
  try {
    return ((await send()).data as GameCreateResponse).game;
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "in_flight") throw err;
    await sleep((err.retryAfterSec ?? 2) * 1000);
    return ((await send()).data as GameCreateResponse).game;
  }
}

export function useCreateBotGame(options: { navigate?: boolean } = {}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: async (body: GameCreateInput) => createBotGameRequest(body, await idempotencyKeyFor(body)),
    onSuccess: (game) => {
      queryClient.setQueryData(qk.games.detail(game.ref), game);
      if (options.navigate ?? true) router.push(`/game/${game.ref}`);
    },
    meta: { object: "the game", errorUi: "inline" },
  });
}

const retryable = (err: unknown) =>
  err instanceof ApiError && (err.status === 0 ? err.code === "network" || err.code === "timeout" || err.code === "offline" : err.status >= 500);

/** POST /api/games/[ref]/complete with the 1 s / 4 s / 15 s retries (network and 5xx only). */
export async function completeBotGameRequest(
  ref: string,
  body: CompleteBody,
  delays: readonly number[] = COMPLETE_RETRY_DELAYS_MS,
  wait: (ms: number) => Promise<unknown> = sleep,
): Promise<CompleteResponse> {
  const schema = process.env.NODE_ENV === "production" ? undefined : CompleteResponseSchema;
  for (let attempt = 0; ; attempt++) {
    try {
      const { data } = await api(gamePath(endpoints.gameComplete, ref), { method: "POST", body, schema, keepalive: true });
      return data as CompleteResponse;
    } catch (err) {
      const delay = delays[attempt];
      if (delay === undefined || !retryable(err)) throw err;
      await wait(delay);
    }
  }
}

/** Seeds the finished game's snapshot and marks the game lists stale without refetching them. */
export function applyCompleted(queryClient: QueryClient, ref: string, result: CompleteResponse, plies: number): void {
  queryClient.setQueryData<GameSnapshot>(qk.games.detail(ref), (prev) =>
    prev ? { ...prev, status: result.status, phase: "ended" } : prev,
  );
  void queryClient.invalidateQueries({ queryKey: qk.games.detail(ref), refetchType: "none" });
  void queryClient.invalidateQueries({ queryKey: qk.games.all(), refetchType: "none" });
  // P3 (phase-03 plan §5.8): seed the game-over card's analysis status and legend block (lazy: not in /game's first load).
  void import("@/features/review/game-over/seed").then(
    (m) => m.seedReviewStatusFromComplete(queryClient, ref, result, plies),
    () => undefined,
  );
}

export function useCompleteBotGame(ref: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CompleteBody) => completeBotGameRequest(ref, body),
    onSuccess: (result, body) => applyCompleted(queryClient, ref, result, body.moves.length),
    onError: (err) => {
      if (err instanceof ApiError && err.code === "illegal_moves") {
        toast.error(COMPLETE_SAVE_FAILED_TEXT, { id: `complete:${ref}` });
        withSentry((Sentry) => Sentry.captureMessage("bot_complete_refused", { level: "error", tags: { game_ref: ref, code: err.code } }));
      }
    },
    meta: { object: "the game", errorUi: "inline" },
  });
}

export function useCancelLegacyChallenge() {
  const router = useRouter();
  return useMutation({
    mutationFn: async (gameReferenceId: string) => {
      await api("/api/chess/cancel-game", { method: "POST", body: { gameReferenceId } });
    },
    onSettled: () => router.push("/play"),
    meta: { object: "the challenge", errorUi: "inline" },
  });
}
