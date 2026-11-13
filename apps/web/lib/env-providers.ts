// Provider base URLs and the Lichess OAuth client id (phase-04 plan §7.9; testing X12). Server-only, pure: every
// function takes the env as an argument, so the guards are unit-tested without touching process.env.
//
//   providerBaseUrls(env)  Chess.com and Lichess origins. `CHESSCOM_API_BASE` / `LICHESS_BASE_URL` point the web at
//                          the e2e upstream mock (http://localhost:4010/…) in test builds; a production app
//                          (NEXT_PUBLIC_APP_ENV or APP_ENV = production) refuses anything but the real origins, so a
//                          stray override can never send members' lookups or OAuth codes somewhere else.
//   lichessClientId(env)   `LICHESS_CLIENT_ID` (D4-20: `replay-chess-dev` on dev, `playchess.tech` in P13).
//   upstreamContact(env)   `UPSTREAM_CONTACT`, the User-Agent contact (R-CC-03).
//
// WP-D adds `dodoApiBaseUrl(env)` to this file (only `APP_ENV=test` may override it, D4-19).

type Env = Readonly<Record<string, string | undefined>>;

export const CHESSCOM_API_BASE_DEFAULT = "https://api.chess.com";
export const LICHESS_BASE_URL_DEFAULT = "https://lichess.org";
export const LICHESS_CLIENT_ID_DEFAULT = "replay-chess-dev";
export const UPSTREAM_CONTACT_DEFAULT = "hello@playchess.tech";

export type ProviderBaseUrls = { chesscom: string; lichess: string };

/** A provider base URL override the current environment does not allow (fails loudly at the first call). */
export class ProviderEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderEnvError";
  }
}

/** True for a production app: either env name says so (the web inlines NEXT_PUBLIC_APP_ENV; scripts set APP_ENV). */
export function isProductionEnv(env: Env): boolean {
  return env.NEXT_PUBLIC_APP_ENV === "production" || env.APP_ENV === "production";
}

/** `https://x.test/base/` → `https://x.test/base`; throws on anything that is not a plain http(s) URL. */
function normalise(name: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderEnvError(`${name} is not a URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ProviderEnvError(`${name} must be http(s)`);
  if (url.username || url.password) throw new ProviderEnvError(`${name} must not carry credentials`);
  if (url.search || url.hash) throw new ProviderEnvError(`${name} must not carry a query or fragment`);
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

function pick(env: Env, name: string, fallback: string): string {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = normalise(name, raw);
  if (isProductionEnv(env) && value !== fallback) {
    throw new ProviderEnvError(`${name} may not be overridden in production (got a non-default origin)`);
  }
  return value;
}

export function providerBaseUrls(env: Env = process.env): ProviderBaseUrls {
  return {
    chesscom: pick(env, "CHESSCOM_API_BASE", CHESSCOM_API_BASE_DEFAULT),
    lichess: pick(env, "LICHESS_BASE_URL", LICHESS_BASE_URL_DEFAULT),
  };
}

export function lichessClientId(env: Env = process.env): string {
  const raw = env.LICHESS_CLIENT_ID?.trim();
  if (!raw) return LICHESS_CLIENT_ID_DEFAULT;
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(raw)) throw new ProviderEnvError("LICHESS_CLIENT_ID has unexpected characters");
  return raw;
}

export function upstreamContact(env: Env = process.env): string {
  const raw = env.UPSTREAM_CONTACT?.trim();
  return raw && raw.length <= 120 ? raw : UPSTREAM_CONTACT_DEFAULT;
}

/** The Dodo API base (test builds only, D4-19): WP-D's guard, exported beside the other provider bases. */
export { dodoApiBaseUrl, DodoBaseUrlRefusedError } from "./billing/dodo-env";
