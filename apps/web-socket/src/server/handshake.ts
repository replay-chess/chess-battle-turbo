// The socket.io handshake (phase-02 plan 7.4.1 "Handshake", 11.2 rules 1 and 8). Every socket is authenticated:
// `SOCKET_AUTH_REQUIRED` no longer exists (socket F-02). Order:
//   1. per-IP flood guard (off for the first 120 s after boot, the restore reconnect burst);
//   2. `proto`: 2 → v2; missing → v1 while PROTOCOL_V1=on, else `upgrade_required`;
//   3. token: v2 claims (`verifySocketToken`: HMAC with SOCKET_TOKEN_SECRET[kid], exp, env, v = 2); a v1 socket may
//      also present the legacy `{sub, exp}` token signed with the bare legacy secret;
//   4. per-user limits (≤ 10 open sockets, ≤ 20 handshakes a minute);
//   5. `socket.data` = the verified identity. The connection handler joins `user:{sub}` and sends `session:hello`.
// Refusals are `connect_error` with the message `unauthorized` | `upgrade_required` | `rate_limited`.
import { verifySocketTokenDetailed } from "@repo/contracts/socket/token";
import { PROTOCOL_VERSION } from "@repo/contracts/socket/limits";
import type { ConnectErrorCode } from "@repo/contracts/socket/codes";
import type { Socket } from "socket.io";
import type { ServerEnv } from "../config/env";
import type { Logger, Metrics } from "../ports";
import type { HandshakeLimiter } from "./rateLimit";
import { legacySecret } from "../v1/utils/internalAuth";
import { verifyLegacySocketToken } from "../v1/utils/socketAuth";

/** What a socket carries after the handshake. Identity comes only from here (plan 11.2 rule 1). */
export interface SocketData {
  proto: 1 | 2;
  /** users.referenceId (`sub`). */
  userRef: string;
  name: string;
  role: "user" | "admin";
  /** Entitled until (unix s) from the newest token; 0 = not a member. Refreshed by `session:refresh_token`. */
  ent: number;
  /** Expiry of the newest token (unix s). A live socket outlives it (plan 7.4.1 step 5). */
  tokenExp: number;
  e2eRun?: string;
  /** The address the limits count (after `x-forwarded-for` when TRUST_PROXY). */
  ip: string;
  /** The client bundle id (`auth.build`), for logs only. */
  build?: string;
  /** True once the limiter counted this socket (so `closed` runs exactly once). */
  counted?: boolean;
}

export interface HandshakeDeps {
  env: Pick<ServerEnv, "appEnv" | "protocolV1" | "socketKeys" | "trustProxy">;
  limiter: HandshakeLimiter;
  now: () => number;
  log: Logger;
  metrics: Metrics;
}

type Next = (err?: Error) => void;

function refuse(next: Next, code: ConnectErrorCode): void {
  const err = new Error(code) as Error & { data?: { code: ConnectErrorCode } };
  err.data = { code };
  next(err);
}

/** The client address the per-IP guard counts. */
export function clientIp(socket: Pick<Socket, "handshake">, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = socket.handshake.headers["x-forwarded-for"];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return socket.handshake.address || "unknown";
}

export function createHandshake(deps: HandshakeDeps) {
  const { env, limiter, now, log, metrics } = deps;

  return function handshake(socket: Socket, next: Next): void {
    const t = now();
    const ip = clientIp(socket, env.trustProxy);
    if (!limiter.checkIp(ip, t)) {
      metrics.count("ws.handshake.refused", { reason: "ip_limit" });
      return refuse(next, "rate_limited");
    }

    const auth = (socket.handshake.auth ?? {}) as { token?: unknown; proto?: unknown; build?: unknown };
    const proto: 1 | 2 | null = auth.proto === PROTOCOL_VERSION ? 2 : auth.proto === undefined ? 1 : null;
    if (proto === null || (proto === 1 && !env.protocolV1)) {
      metrics.count("ws.handshake.refused", { reason: "upgrade_required" });
      return refuse(next, "upgrade_required");
    }

    let data: Omit<SocketData, "ip"> | null = null;
    const verified = verifySocketTokenDetailed(auth.token, env.socketKeys, t, env.appEnv);
    if (verified.ok) {
      const c = verified.claims;
      data = {
        proto,
        userRef: c.sub,
        name: c.name,
        role: c.role,
        ent: c.ent,
        tokenExp: c.exp,
        ...(c.e2eRun ? { e2eRun: c.e2eRun } : {}),
      };
    } else if (proto === 1) {
      // v1 clients may still hold the legacy `{sub, exp}` token (until WP-E's v2 token ships everywhere).
      const legacy = verifyLegacySocketToken(auth.token, legacySecret(), Math.floor(t / 1000));
      if (legacy) data = { proto, userRef: legacy.userReferenceId, name: "", role: "user", ent: 0, tokenExp: 0 };
    }
    if (!data) {
      metrics.count("ws.handshake.refused", { reason: verified.ok ? "legacy" : verified.reason });
      log.debug("handshake refused", { reason: verified.ok ? "legacy" : verified.reason, proto });
      return refuse(next, "unauthorized");
    }

    if (!limiter.checkUser(data.userRef, t)) {
      metrics.count("ws.handshake.refused", { reason: "user_limit" });
      return refuse(next, "rate_limited");
    }

    const socketData: SocketData = { ...data, ip, counted: true };
    if (typeof auth.build === "string" && auth.build.length <= 40) socketData.build = auth.build;
    limiter.opened(data.userRef, ip);
    socket.data = socketData;
    metrics.count("ws.socket_event", { proto, event: "connect" });
    next();
  };
}

/** Releases the limiter counts of a socket (call once, on `disconnect`). */
export function releaseHandshake(limiter: HandshakeLimiter, data: Partial<SocketData>): void {
  if (!data.counted || !data.userRef || !data.ip) return;
  data.counted = false;
  limiter.closed(data.userRef, data.ip);
}
