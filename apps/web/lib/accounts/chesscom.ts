// The web side of Chess.com (phase-04 plan §7.3.1, §7.3.2, §5.4 Confirm, §9.3 L3; D4-23). Server-only.
//
//   chesscomLookup(u)        profile then stats, serially (R-CC-02), through @repo/chess-import's ChessComClient with
//                            no gate (a 429 must fall back at once, not wait 60 s). Cached 600 s in Next's data cache
//                            (`unstable_cache`, key ["cc-lookup", u], tag `chesscom:<u>`) through the route seam:
//                            `found`, `private` AND `not_found` are cached (a repeated typo costs nothing); 429, 5xx
//                            and timeouts throw and are never cached.
//   chesscomRecentGames(u)   the confirm aside: archives → the newest month (+ the previous one when it holds fewer
//                            than five rated games), cached 600 s (tag `chesscom:<u>`).
//
// Worker fallback (D4-23, feasibility F-API-1): when a web call gets 429 or 403 (Vercel's shared egress IPs), the
// same question goes to the worker (`workerLookup`, 6 s budget); the cached value records `source: web | worker`.
// Errors the routes answer (§7.3.1 step 5): the worker's `rate_limited` → 429 `rate_limited {source: "chesscom"}`
// (`retryAfterSec` from the worker, else 30); a worker timeout / failure, or a web timeout / 5xx → 502
// `upstream_unavailable {provider: "chesscom", kind: "timeout" | "error"}`.
import { ChessComClient, compareMonthKeys, monthKeyOfArchiveUrl } from "@repo/chess-import/chesscom/client";
import { chessComSchemas, type ChessComProfile, type ChessComStats, type MonthKey } from "@repo/chess-import/chesscom/types";
import { isProviderError, type ProviderError } from "@repo/chess-import/errors";
import type { FetchLike } from "@repo/chess-import/http";
import { LOOKUP_CACHE_SEC } from "@repo/contracts/http/accounts";
import { ApiError } from "@/lib/api/api-error";
import { cachedData, getRouteDeps } from "@/lib/api/context";
import { providerBaseUrls, upstreamContact } from "@/lib/env-providers";
import { chessComRecent, type RecentGame } from "./preview";
import { workerLookup } from "./worker-lookup";

/** `Retry-After` default when Chess.com (through the worker) limits without one (§7.3.1 step 5). */
export const DEFAULT_RETRY_AFTER_SEC = 30;
/** The confirm aside reads a second month when the newest one has fewer rated games than this. */
export const RECENT_GAMES = 5;

export type LookupSource = "web" | "worker";
/** `fallbackStatus`: the web call's status that sent the question to the worker (the `account_lookup_fallback_used` event). */
export type ChessComLookup = (
  | { kind: "found"; source: LookupSource; profile: ChessComProfile; stats: ChessComStats }
  | { kind: "private"; source: LookupSource; profile: ChessComProfile | null }
  | { kind: "not_found"; source: LookupSource }
) & { fallbackStatus?: 403 | 429 };

let fetchImpl: FetchLike = (input, init) => fetch(input, init);

/** Test seam: the HTTP transport of the web's Chess.com client (the worker fallback has its own seam). */
export function setChessComFetch(next: FetchLike): () => void {
  const previous = fetchImpl;
  fetchImpl = next;
  return () => {
    fetchImpl = previous;
  };
}

function client(): ChessComClient {
  const env = getRouteDeps().env;
  return new ChessComClient({
    baseUrl: providerBaseUrls(env).chesscom,
    contact: upstreamContact(env),
    caller: "web",
    gate: null,
    fetch: (input, init) => fetchImpl(input, init),
  });
}

/** 429 or 403 from the web's own call: Chess.com is limiting Vercel's IPs → ask the worker. */
export function shouldFallBack(e: ProviderError): boolean {
  return e.kind === "rate_limited" || e.status === 403;
}

export function upstreamError(kind: "timeout" | "error", extra: Record<string, unknown> = {}): ApiError {
  return new ApiError("upstream_unavailable", { details: { provider: "chesscom", kind, ...extra } });
}

function rateLimited(retryAfterSec: number | null | undefined): ApiError {
  return new ApiError("rate_limited", {
    retryAfterSec: retryAfterSec && retryAfterSec > 0 ? retryAfterSec : DEFAULT_RETRY_AFTER_SEC,
    details: { source: "chesscom" },
  });
}

function fallbackUsed(status: number, result: string): void {
  const deps = getRouteDeps();
  deps.telemetry.count("import.lookup_source", { source: "worker" });
  deps.telemetry.breadcrumb({ category: "accounts", message: "accounts.lookup_fallback", level: "info", data: { status, result } });
}

/** The worker's answer for profile+stats, re-validated with the lenient Chess.com schemas. */
async function lookupThroughWorker(u: string, status: number): Promise<ChessComLookup> {
  const r = await workerLookup({ v: 1, username: u, what: "profile+stats" });
  if (!r.ok) {
    fallbackUsed(status, r.kind);
    throw upstreamError(r.kind, { via: "worker" });
  }
  const data = r.data;
  fallbackUsed(status, data.kind);
  const fallbackStatus = status === 403 ? 403 : 429;
  switch (data.kind) {
    case "rate_limited":
      throw rateLimited(data.retryAfterSec);
    case "not_found":
      return { kind: "not_found", source: "worker", fallbackStatus };
    case "private":
      return { kind: "private", source: "worker", profile: null, fallbackStatus };
    case "found": {
      const schemas = chessComSchemas("lenient");
      const profile = schemas.profile.safeParse(data.profile);
      const stats = schemas.stats.safeParse(data.stats ?? {});
      if (!profile.success || !stats.success) throw upstreamError("error", { via: "worker", reason: "bad_response" });
      return { kind: "found", source: "worker", profile: profile.data, stats: stats.data, fallbackStatus };
    }
  }
}

/** Uncached: one serial profile + stats read, the fallback on 429/403. */
export async function fetchChessComLookup(u: string): Promise<ChessComLookup> {
  try {
    const { profile, stats } = await client().getPreview(u);
    getRouteDeps().telemetry.count("import.lookup_source", { source: "web" });
    return { kind: "found", source: "web", profile, stats };
  } catch (e) {
    if (!isProviderError(e)) throw e;
    if (e.kind === "not_found") return { kind: "not_found", source: "web" };
    if (e.kind === "closed") return { kind: "private", source: "web", profile: null };
    if (shouldFallBack(e)) return lookupThroughWorker(u, e.status ?? 429);
    throw upstreamError(e.kind === "timeout" ? "timeout" : "error");
  }
}

/** Lower-cased, validated handle (the cache and link key). Callers pass the zod-parsed `ChessComUsername`. */
export function lookupKey(username: string): string {
  return username.trim().toLowerCase();
}

/** The cached lookup and whether this call hit the cache (span tag `cache`). */
export async function chesscomLookup(username: string): Promise<{ value: ChessComLookup; cache: "hit" | "miss" }> {
  const u = lookupKey(username);
  let ran = false;
  const value = await cachedData(
    async () => {
      ran = true;
      return fetchChessComLookup(u);
    },
    ["cc-lookup", u],
    { revalidate: LOOKUP_CACHE_SEC, tags: [`chesscom:${u}`] },
  )();
  return { value, cache: ran ? "miss" : "hit" };
}

/** The cache tag a successful link revalidates (so Connected shows fresh ratings). */
export function chesscomCacheTag(username: string): string {
  return `chesscom:${lookupKey(username)}`;
}

// ── Confirm: the five most recent games ─────────────────────────────────────────────────────────────────────────

const MONTH_KEY_RE = /^\d{4}\/\d{2}$/;

function monthKeysOf(entries: readonly string[]): MonthKey[] {
  const keys: MonthKey[] = [];
  for (const e of entries) {
    const key = MONTH_KEY_RE.test(e) ? (e as MonthKey) : monthKeyOfArchiveUrl(e);
    if (key) keys.push(key);
  }
  return keys.sort(compareMonthKeys);
}

async function monthThroughWorker(u: string, month: MonthKey | undefined): Promise<{ months: MonthKey[]; games: unknown[] }> {
  const r = await workerLookup({ v: 1, username: u, what: "archives+month", ...(month ? { month } : {}) });
  if (!r.ok) throw upstreamError(r.kind, { via: "worker" });
  const data = r.data;
  if (data.kind === "rate_limited") throw rateLimited(data.retryAfterSec);
  if (data.kind !== "found") return { months: [], games: [] };
  const body = chessComSchemas("lenient").month.safeParse(data.month ?? { games: [] });
  if (!body.success) throw upstreamError("error", { via: "worker", reason: "bad_response" });
  return { months: monthKeysOf(data.archives ?? []), games: body.data.games };
}

/** Uncached: archives, the newest month, and the previous one when needed. */
export async function fetchChessComRecentGames(u: string): Promise<RecentGame[]> {
  const c = client();
  let months: MonthKey[];
  let games: unknown[];
  try {
    const archives = await c.getArchives(u);
    months = archives.status === 200 ? archives.months : [];
    const newest = months.at(-1);
    if (!newest) return [];
    const month = await c.getMonth(u, newest);
    games = month.status === 200 ? month.games : [];
  } catch (e) {
    if (!isProviderError(e)) throw e;
    if (e.kind === "not_found" || e.kind === "closed") return [];
    if (!shouldFallBack(e)) throw upstreamError(e.kind === "timeout" ? "timeout" : "error");
    fallbackUsed(e.status ?? 429, "archives");
    ({ months, games } = await monthThroughWorker(u, undefined));
  }
  let recent = chessComRecent(games, u, RECENT_GAMES);
  const previous = months.at(-2);
  if (recent.length < RECENT_GAMES && previous) {
    let older: unknown[] = [];
    try {
      const month = await c.getMonth(u, previous);
      older = month.status === 200 ? month.games : [];
    } catch (e) {
      if (!isProviderError(e)) throw e;
      if (shouldFallBack(e)) older = (await monthThroughWorker(u, previous)).games;
      else if (e.kind !== "not_found") throw upstreamError(e.kind === "timeout" ? "timeout" : "error");
    }
    recent = chessComRecent([...games, ...older], u, RECENT_GAMES);
  }
  return recent;
}

export function chesscomRecentGames(username: string): Promise<RecentGame[]> {
  const u = lookupKey(username);
  return cachedData(() => fetchChessComRecentGames(u), ["cc-recent", u], {
    revalidate: LOOKUP_CACHE_SEC,
    tags: [`chesscom:${u}`, `chesscom:${u}:archives`],
  })();
}
