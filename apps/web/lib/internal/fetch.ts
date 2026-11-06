// internalFetch(): every web → socket-server `/internal/*` call (phase-02 plan §7.5.1). Server-only.
//
// Signs the exact bytes it sends with `signInternal()` from `@repo/contracts/internal/auth` (x-rc-kid, x-rc-ts,
// x-rc-sig over ts, METHOD, path + query and sha256(body)), using the first key of INTERNAL_API_SECRET
// ("kid:base64[,kid:base64]"; a bare legacy value is read as kid `web`). Nobody writes these headers by hand, and the
// static `x-internal-token` is never sent: the v2 server does not read it (only `WS/src/v1/` behind PROTOCOL_V1 does).
//
// The base URL is the socket server's HTTP origin, derived from NEXT_PUBLIC_WEBSOCKET_URL (ws → http, wss → https).
import { type KeyRing, parseKeyRing, signInternal } from "@repo/contracts/internal/auth";

type Env = Readonly<Record<string, string | undefined>>;

export const INTERNAL_FETCH_TIMEOUT_MS = 3_000;
const DEFAULT_SOCKET_ORIGIN = "http://localhost:3002";

export class InternalFetchConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InternalFetchConfigError";
  }
}

/** The socket server's HTTP origin (no trailing slash). */
export function socketHttpOrigin(env: Env = process.env): string {
  const raw = (env.NEXT_PUBLIC_WEBSOCKET_URL || DEFAULT_SOCKET_ORIGIN).trim();
  const http = raw.replace(/^ws:\/\//i, "http://").replace(/^wss:\/\//i, "https://");
  return http.replace(/\/+$/, "");
}

/** The ring web signs with. Throws InternalFetchConfigError when unset or malformed (never echoing key material). */
export function internalKeyRing(env: Env = process.env): KeyRing {
  let ring: KeyRing;
  try {
    ring = parseKeyRing(env.INTERNAL_API_SECRET);
  } catch (err) {
    throw new InternalFetchConfigError(err instanceof Error ? err.message : "INTERNAL_API_SECRET is malformed");
  }
  if (!ring.signingKid) throw new InternalFetchConfigError("INTERNAL_API_SECRET is not set");
  return ring;
}

export type InternalFetchInit = {
  method?: "POST" | "GET";
  /** JSON-serialised once; the signature covers exactly these bytes. */
  body?: unknown;
  timeoutMs?: number;
  env?: Env;
  nowMs?: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
};

/**
 * Signs and sends one request to the socket server. `path` starts with "/internal/" and may carry a query string
 * (it is signed as sent). Resolves with the Response; network errors and timeouts reject (callers decide).
 */
export async function internalFetch(path: string, init: InternalFetchInit = {}): Promise<Response> {
  if (!path.startsWith("/internal/")) throw new Error(`internalFetch: ${path} is not an /internal/* path`);
  const env = init.env ?? process.env;
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  const body = init.body === undefined ? "" : JSON.stringify(init.body);
  const headers: Record<string, string> = {
    ...signInternal({ keys: internalKeyRing(env), method, path, body, nowMs: init.nowMs ?? Date.now() }),
  };
  if (body) headers["content-type"] = "application/json";
  const doFetch = init.fetchImpl ?? fetch;
  return doFetch(`${socketHttpOrigin(env)}${path}`, {
    method,
    headers,
    ...(body ? { body } : {}),
    signal: AbortSignal.timeout(init.timeoutMs ?? INTERNAL_FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
}
