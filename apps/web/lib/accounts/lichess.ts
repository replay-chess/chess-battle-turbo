// The web side of Lichess (phase-04 plan §7.3.4, §7.3.5, §7.8, §8.14; D4-20, D4-21). Server-only.
//
// OAuth (PKCE, no scopes) proves ownership only. The callback runs exchangeCode() → readAccount() → revokeToken()
// inside one request; the access token lives in that function's memory and is revoked in a `finally` on every path
// (success, conflict, DB error). It is never stored, logged, sent to Sentry or put in a cookie. revokeToken() retries
// once, then reports the Sentry warning `lichess.revoke_failed` (the token is scope-less and expires by itself).
//
// lichessRecentGames(u) is the confirm aside (anonymous export of the newest five rated games, no moves), cached
// 600 s (tag `lichess:<id>:recent`).
import { LichessClient } from "@repo/chess-import/lichess/client";
import { lichessSchemas, type LichessAccount } from "@repo/chess-import/lichess/types";
import { isProviderError } from "@repo/chess-import/errors";
import { userAgent, type FetchLike } from "@repo/chess-import/http";
import { LOOKUP_CACHE_SEC } from "@repo/contracts/http/accounts";
import { ApiError } from "@/lib/api/api-error";
import { cachedData, getRouteDeps } from "@/lib/api/context";
import { lichessClientId, providerBaseUrls, upstreamContact } from "@/lib/env-providers";
import { lichessRecent, type RecentGame } from "./preview";

/** §7.8: token 8 s, account 5 s, revoke 5 s. */
export const LICHESS_OAUTH_TIMEOUTS = { token: 8_000, account: 5_000, revoke: 5_000 } as const;

let fetchImpl: FetchLike = (input, init) => fetch(input, init);

/** Test seam: every Lichess HTTP call of the web (OAuth and the recent-games export). */
export function setLichessFetch(next: FetchLike): () => void {
  const previous = fetchImpl;
  fetchImpl = next;
  return () => {
    fetchImpl = previous;
  };
}

/** A Lichess OAuth step that failed. Carries no token, code or verifier (safe to log). */
export class LichessOAuthError extends Error {
  constructor(
    readonly step: "token" | "account",
    readonly kind: "timeout" | "error" | "denied",
    readonly status: number | null = null,
  ) {
    super(`lichess ${step} ${kind}${status ? ` (${status})` : ""}`);
    this.name = "LichessOAuthError";
  }
}

function base(): string {
  return providerBaseUrls(getRouteDeps().env).lichess;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { "User-Agent": userAgent(upstreamContact(getRouteDeps().env)), Accept: "application/json", ...extra };
}

async function call(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store", redirect: "error" });
}

const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

/** The authorize URL of the consent page (`GET /oauth`, no `scope`: R-LI-04). */
export function authorizeUrl(input: { redirectUri: string; challenge: string; state: string }): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: lichessClientId(getRouteDeps().env),
    redirect_uri: input.redirectUri,
    code_challenge_method: "S256",
    code_challenge: input.challenge,
    state: input.state,
  });
  return `${base()}/oauth?${q.toString()}`;
}

/** `POST /api/token` (form body). Returns the access token; throws LichessOAuthError. */
export async function exchangeCode(input: { code: string; verifier: string; redirectUri: string }): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.verifier,
    redirect_uri: input.redirectUri,
    client_id: lichessClientId(getRouteDeps().env),
  });
  let res: Response;
  try {
    res = await call(`${base()}/api/token`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: body.toString(),
    }, LICHESS_OAUTH_TIMEOUTS.token);
  } catch (e) {
    throw new LichessOAuthError("token", isTimeout(e) ? "timeout" : "error");
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new LichessOAuthError("token", res.status === 400 || res.status === 401 ? "denied" : "error", res.status);
  const token = json && typeof json === "object" ? (json as { access_token?: unknown }).access_token : undefined;
  if (typeof token !== "string" || token.length < 8 || token.length > 512) throw new LichessOAuthError("token", "error", res.status);
  return token;
}

/** `GET /api/account` with the token: the ownership proof. */
export async function readAccount(token: string): Promise<LichessAccount> {
  let res: Response;
  try {
    res = await call(`${base()}/api/account`, { method: "GET", headers: headers({ Authorization: `Bearer ${token}` }) }, LICHESS_OAUTH_TIMEOUTS.account);
  } catch (e) {
    throw new LichessOAuthError("account", isTimeout(e) ? "timeout" : "error");
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new LichessOAuthError("account", "error", res.status);
  const parsed = lichessSchemas("lenient").account.safeParse(json);
  if (!parsed.success) throw new LichessOAuthError("account", "error", res.status);
  return parsed.data;
}

async function revokeOnce(token: string): Promise<boolean> {
  try {
    const res = await call(`${base()}/api/token`, { method: "DELETE", headers: headers({ Authorization: `Bearer ${token}` }) }, LICHESS_OAUTH_TIMEOUTS.revoke);
    await res.arrayBuffer().catch(() => undefined);
    return res.ok;
  } catch {
    return false;
  }
}

/** `DELETE /api/token`: one retry, then the Sentry warning `lichess.revoke_failed`. Never throws. */
export async function revokeToken(token: string): Promise<boolean> {
  if (await revokeOnce(token)) return true;
  if (await revokeOnce(token)) return true;
  getRouteDeps().telemetry.captureMessage("lichess.revoke_failed", { level: "warning", tags: { provider: "lichess" } });
  return false;
}

/** Lichess's `count.rated`, or the sum of the rated perfs' games when absent. */
export function ratedCountOf(account: LichessAccount): number | null {
  const count = account.count;
  if (count && typeof count === "object" && typeof (count as { rated?: unknown }).rated === "number") {
    const n = (count as { rated: number }).rated;
    return Number.isInteger(n) && n >= 0 ? n : null;
  }
  return null;
}

/** `profile.flag` ("PT", "GB-ENG" …) → a 2-letter country code, or null. */
export function countryOf(account: LichessAccount): string | null {
  const profile = account.profile;
  const flag = profile && typeof profile === "object" ? (profile as { flag?: unknown }).flag : undefined;
  if (typeof flag !== "string") return null;
  const cc = flag.slice(0, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

/** Uncached: the newest five rated games, anonymously (no moves). An upstream failure is a 502. */
export async function fetchLichessRecentGames(username: string): Promise<RecentGame[]> {
  const env = getRouteDeps().env;
  const client = new LichessClient({ baseUrl: providerBaseUrls(env).lichess, contact: upstreamContact(env), gate: null, fetch: (i, init) => fetchImpl(i, init) });
  try {
    return lichessRecent(await client.recentGames(username, 5), username.toLowerCase(), 5);
  } catch (e) {
    if (isProviderError(e) && (e.kind === "not_found" || e.kind === "closed")) return [];
    throw new ApiError("upstream_unavailable", {
      details: { provider: "lichess", kind: isProviderError(e) && e.kind === "timeout" ? "timeout" : "error" },
    });
  }
}

export function lichessRecentGames(username: string): Promise<RecentGame[]> {
  const u = username.toLowerCase();
  return cachedData(() => fetchLichessRecentGames(u), ["li-recent", u], { revalidate: LOOKUP_CACHE_SEC, tags: [`lichess:${u}:recent`] })();
}
