// The Lichess OAuth link flow (phase-04 plan §7.3.4, §7.3.5, §8.14, §8.15; D4-20, D4-21, D4-29). Server-only; the two
// GET routes (`/api/accounts/lichess/start`, `/callback`) are thin wrappers over startLichessLink() and
// finishLichessLink(), which return the redirect (and its cookies) as data so the tests can read every path.
//
// start:    signed out → /sign-in; rate limited → returnTo?lichess=error&reason=rate_limited; else PKCE (S256) +
//           state in the HMAC-signed `rc_lichess_pkce` cookie (Path=/api/accounts/lichess, 10 min, HttpOnly,
//           SameSite=Lax, bound to the Clerk user id) and a 302 to Lichess's consent page (no scopes).
// callback: always clears the cookie; a bad / expired / foreign cookie or a state mismatch → reason=state;
//           `?error=access_denied` → lichess=denied; another error → reason=upstream; then the code exchange, the
//           ownership proof (`GET /api/account`), the link transaction, and the token's revoke in a `finally` — on
//           every path that obtained a token. Conflicts → reason=linked_elsewhere | already_linked.
//           Success: onboarding → /onboarding/confirm?provider=lichess; settings → /settings/connected?lichess=linked.
import { LICHESS_RETURN_PATHS, type LichessErrorReason, type LichessReturnPath } from "@repo/contracts/http/p04-plain";
import type { LinkEffect } from "./link-service";
import { linkLichess } from "./link-service";
import { authorizeUrl, countryOf, exchangeCode, LichessOAuthError, ratedCountOf, readAccount, revokeToken } from "./lichess";
import { newOAuthState, newPkceVerifier, pkceChallenge, timingSafeEqualText } from "./pkce";
import type { Viewer } from "@/lib/auth/viewer";
import {
  clearCookie,
  readCookie,
  serializeCookie,
  signCookieValue,
  signedCookieSecret,
  verifyCookieValue,
} from "@/lib/crypto/signed-cookie";

export const PKCE_COOKIE = "rc_lichess_pkce";
export const PKCE_COOKIE_PATH = "/api/accounts/lichess";
export const PKCE_COOKIE_TTL_SEC = 600;
export const CALLBACK_PATH = "/api/accounts/lichess/callback";

type Env = Readonly<Record<string, string | undefined>>;

export type Redirect = { location: string; cookies: string[] };

type PkcePayload = { v: 1; exp: number; sub: string; verifier: string; state: string; returnTo: LichessReturnPath };

const isReturnPath = (v: unknown): v is LichessReturnPath => (LICHESS_RETURN_PATHS as readonly unknown[]).includes(v);

function to(origin: string, path: string, query: Record<string, string> = {}): string {
  const url = new URL(path, origin);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}

function cookieSecure(origin: string): boolean {
  return new URL(origin).protocol === "https:";
}

function errorTo(origin: string, returnTo: LichessReturnPath, reason: LichessErrorReason): string {
  return to(origin, returnTo, { lichess: "error", reason });
}

/** The secret, or a clear error: P4 created SIGNED_COOKIE_SECRET (an owner action on every deployment). */
function secretOf(env: Env): string {
  const secret = signedCookieSecret(env);
  if (!secret) throw new Error("SIGNED_COOKIE_SECRET is not set (≥ 32 chars): the Lichess link cannot run");
  return secret;
}

export async function startLichessLink(input: {
  origin: string;
  returnTo: LichessReturnPath;
  clerkUserId: string | null;
  rateLimited: boolean;
  now: Date;
  env: Env;
}): Promise<Redirect> {
  const { origin, returnTo } = input;
  if (!input.clerkUserId) return { location: to(origin, "/sign-in", { redirect_url: returnTo }), cookies: [] };
  if (input.rateLimited) return { location: errorTo(origin, returnTo, "rate_limited"), cookies: [] };
  const verifier = newPkceVerifier();
  const state = newOAuthState();
  const payload: PkcePayload = { v: 1, exp: input.now.getTime() + PKCE_COOKIE_TTL_SEC * 1000, sub: input.clerkUserId, verifier, state, returnTo };
  const value = await signCookieValue(payload, secretOf(input.env));
  const cookie = serializeCookie(PKCE_COOKIE, value, {
    maxAgeSec: PKCE_COOKIE_TTL_SEC,
    path: PKCE_COOKIE_PATH,
    secure: cookieSecure(origin),
  });
  const location = authorizeUrl({ redirectUri: to(origin, CALLBACK_PATH), challenge: await pkceChallenge(verifier), state });
  return { location, cookies: [cookie] };
}

/** The Set-Cookie that clears the single-use PKCE cookie (plan §7.3.5: cleared on every callback path). */
export function clearedPkceCookie(origin: string): string {
  return clearCookie(PKCE_COOKIE, { path: PKCE_COOKIE_PATH, secure: cookieSecure(origin) });
}

export type CallbackQuery =
  | { code: string; state: string }
  | { error: string; state?: string; error_description?: string }
  | { malformed: true };

export type CallbackOutcome = Redirect & {
  /** What happened, for tests and telemetry (never the token). */
  result: "linked" | "denied" | LichessErrorReason;
  /** True when a token was obtained (and therefore revoked). */
  tokenObtained: boolean;
  revoked: boolean | null;
  effects: LinkEffect[];
};

export async function finishLichessLink(input: {
  origin: string;
  cookieHeader: string | null;
  query: CallbackQuery;
  viewer: Pick<Viewer, "id" | "entitlement"> | null;
  clerkUserId: string | null;
  now: Date;
  env: Env;
  /** The DB error reporter (Sentry); the redirect still goes out. */
  onError: (err: unknown) => void;
}): Promise<CallbackOutcome> {
  const { origin } = input;
  const cleared = clearedPkceCookie(origin);
  const out = (location: string, result: CallbackOutcome["result"], extra: Partial<CallbackOutcome> = {}): CallbackOutcome => ({
    location,
    cookies: [cleared],
    result,
    tokenObtained: false,
    revoked: null,
    effects: [],
    ...extra,
  });

  const verified = await verifyCookieValue<PkcePayload>(readCookie(input.cookieHeader, PKCE_COOKIE), secretOf(input.env), {
    nowMs: input.now.getTime(),
    sub: input.clerkUserId ?? "\u0000signed-out",
  });
  const fallbackReturn: LichessReturnPath = "/settings/connected";
  if (!verified.ok || !isReturnPath(verified.payload.returnTo) || !input.viewer) {
    return out(errorTo(origin, fallbackReturn, "state"), "state");
  }
  const { returnTo, verifier, state } = verified.payload;
  // A query that fits neither Lichess shape: the state cannot be checked, so it is a state failure (cookie cleared).
  if ("malformed" in input.query) return out(errorTo(origin, returnTo, "state"), "state");
  const queryState = input.query.state ?? "";
  if ("error" in input.query) {
    if (input.query.error === "access_denied" && timingSafeEqualText(queryState, state)) {
      return out(to(origin, returnTo, { lichess: "denied" }), "denied");
    }
    return out(errorTo(origin, returnTo, timingSafeEqualText(queryState, state) ? "upstream" : "state"), "upstream");
  }
  if (!timingSafeEqualText(input.query.state, state)) return out(errorTo(origin, returnTo, "state"), "state");

  let token: string;
  try {
    token = await exchangeCode({ code: input.query.code, verifier, redirectUri: to(origin, CALLBACK_PATH) });
  } catch (err) {
    if (!(err instanceof LichessOAuthError)) input.onError(err);
    return out(errorTo(origin, returnTo, "upstream"), "upstream");
  }

  // From here a token exists: it is revoked in the finally, before the redirect goes out, whatever happens.
  let outcome: CallbackOutcome;
  let revoked: boolean;
  try {
    outcome = await linkWithToken(token, { ...input, returnTo, out });
  } finally {
    revoked = await revokeToken(token);
  }
  return { ...outcome, revoked };
}

async function linkWithToken(
  token: string,
  input: Parameters<typeof finishLichessLink>[0] & {
    returnTo: LichessReturnPath;
    out: (location: string, result: CallbackOutcome["result"], extra?: Partial<CallbackOutcome>) => CallbackOutcome;
  },
): Promise<CallbackOutcome> {
  const { origin, returnTo, out } = input;
  let account;
  try {
    account = await readAccount(token);
  } catch (err) {
    if (!(err instanceof LichessOAuthError)) input.onError(err);
    return out(errorTo(origin, returnTo, "upstream"), "upstream", { tokenObtained: true });
  }
  const context = returnTo === "/onboarding/link" ? "onboarding" : "settings";
  let linked;
  try {
    linked = await linkLichess({
      viewer: input.viewer!,
      account,
      ratedCount: ratedCountOf(account),
      countryCode: countryOf(account),
      context,
      now: input.now,
    });
  } catch (err) {
    input.onError(err);
    return out(errorTo(origin, returnTo, "upstream"), "upstream", { tokenObtained: true });
  }
  if (linked.kind === "conflict") return out(errorTo(origin, returnTo, linked.reason), linked.reason, { tokenObtained: true });
  const location =
    context === "onboarding"
      ? to(origin, "/onboarding/confirm", { provider: "lichess" })
      : to(origin, "/settings/connected", { lichess: "linked" });
  return out(location, "linked", { tokenObtained: true, effects: linked.effects });
}
