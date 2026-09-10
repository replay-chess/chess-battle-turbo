"use client";

import { useEffect } from "react";
import type { Socket } from "socket.io-client";
import { logger } from "@/lib/logger";

/**
 * Fetches and caches the short-lived WebSocket auth token from
 * GET /api/socket-token.
 *
 * The cache is module-level so every socket on the page (game, tournament
 * lobby) shares one token and one in-flight request. A token is reused until
 * 60s before it expires, then refetched. Failures are never cached: the caller
 * connects without a token (the socket server tolerates that until
 * SOCKET_AUTH_REQUIRED is turned on) and the next attempt tries again.
 */

interface SocketTokenResponse {
  token: string;
  /** Unix seconds. */
  expiresAt: number;
}

interface CachedToken {
  token: string;
  /** Unix seconds. */
  expiresAt: number;
}

const REFRESH_MARGIN_SECONDS = 60;

let cached: CachedToken | null = null;
let inFlight: Promise<string | null> | null = null;

function isFresh(entry: CachedToken | null, nowSeconds: number): entry is CachedToken {
  return entry !== null && entry.expiresAt - REFRESH_MARGIN_SECONDS > nowSeconds;
}

async function fetchSocketToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/socket-token", { cache: "no-store" });
    if (res.status === 401) {
      // Signed out (demo / spectator). Nothing to send; the server decides.
      return null;
    }
    if (!res.ok) {
      logger.warn(`Socket token request failed with status ${res.status}; connecting without a token`);
      return null;
    }
    const data = (await res.json()) as Partial<SocketTokenResponse>;
    if (typeof data.token !== "string" || typeof data.expiresAt !== "number") {
      logger.warn("Socket token response was malformed; connecting without a token");
      return null;
    }
    cached = { token: data.token, expiresAt: data.expiresAt };
    return cached.token;
  } catch (err) {
    logger.warn(
      `Socket token request failed (${err instanceof Error ? err.message : "unknown error"}); connecting without a token`,
    );
    return null;
  }
}

/**
 * Resolve a token for the socket.io `auth` handshake. Resolves to `null`
 * (never rejects) when one cannot be obtained so callers can still connect.
 */
export function getSocketToken(): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (isFresh(cached, now)) return Promise.resolve(cached.token);
  if (inFlight) return inFlight;

  inFlight = fetchSocketToken().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Drop the cached token (e.g. after sign-out) so the next call refetches. */
export function clearSocketToken(): void {
  cached = null;
}

/**
 * The socket.io `auth` option. The function form is called by socket.io-client
 * on every connection attempt, so reconnects after the 15-minute token lifetime
 * automatically pick up a fresh token. When no token can be obtained the
 * handshake is sent without one (rollout safety; see SOCKET_AUTH_REQUIRED on
 * the socket server).
 */
export function socketAuth(cb: (data: object) => void): void {
  getSocketToken().then((token) => cb(token ? { token } : {}));
}

const UNAUTHORIZED_RETRY_DELAYS_MS = [1000, 2000, 4000];

/**
 * socket.io-client does not auto-reconnect after a server middleware rejects
 * the handshake. When the socket server requires auth and our token was stale
 * or could not be fetched, drop the cached token and retry a few times so a
 * transient failure does not strand the player. Returns a cleanup function.
 */
export function retryOnUnauthorized(socket: Socket): () => void {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onConnect = () => {
    attempt = 0;
  };
  const onConnectError = (err: Error) => {
    if (err.message !== "unauthorized") return;
    clearSocketToken();
    const delay = UNAUTHORIZED_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      logger.warn("Socket server rejected the connection as unauthorized; giving up after retries");
      return;
    }
    attempt += 1;
    logger.warn(`Socket server rejected the connection as unauthorized; retrying in ${delay}ms`);
    timer = setTimeout(() => {
      timer = null;
      if (!socket.connected) socket.connect();
    }, delay);
  };

  socket.on("connect", onConnect);
  socket.on("connect_error", onConnectError);

  return () => {
    if (timer) clearTimeout(timer);
    socket.off("connect", onConnect);
    socket.off("connect_error", onConnectError);
  };
}

export interface UseSocketTokenReturn {
  /** Resolves the current (cached or freshly fetched) token, or null. */
  getToken: () => Promise<string | null>;
  /** Ready-made socket.io `auth` option that refreshes on every (re)connect. */
  auth: (cb: (data: object) => void) => void;
}

/**
 * Warms the token cache on mount and exposes `getToken()` for socket setup.
 */
export function useSocketToken(): UseSocketTokenReturn {
  useEffect(() => {
    void getSocketToken();
  }, []);

  return { getToken: getSocketToken, auth: socketAuth };
}
