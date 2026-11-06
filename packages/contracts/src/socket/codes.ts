// Socket error codes (phase-02 plan §7.4.7). Append-only, like the HTTP ledger in ../http/codes.ts.
// Messages that travel with a code are for logs only and never contain user ids or emails.
import { z } from "zod";

/** Codes a command ack (`{ ok: false, code }`) or `game:error` can carry. */
export const SOCKET_ERROR_CODES = [
  "unauthorized",
  "not_member",
  "paywall",
  "forbidden",
  "not_found",
  "phase",
  "ended",
  "not_your_turn",
  "illegal",
  "promotion_required",
  "stale_ply",
  "no_offer",
  "draw_cooldown",
  "not_allowed",
  "expired",
  "rate_limited",
  "draining",
  "internal",
] as const;

export const SocketErrorCode = z.enum(SOCKET_ERROR_CODES);
export type SocketErrorCode = z.infer<typeof SocketErrorCode>;

/**
 * `connect_error` messages of the handshake (§7.4.1): a bad or missing token, a client without `proto: 2` once
 * PROTOCOL_V1 is off, and the per-user / per-IP handshake limits.
 */
export const CONNECT_ERROR_CODES = ["unauthorized", "upgrade_required", "rate_limited"] as const;
export const ConnectErrorCode = z.enum(CONNECT_ERROR_CODES);
export type ConnectErrorCode = z.infer<typeof ConnectErrorCode>;

export function isSocketErrorCode(value: unknown): value is SocketErrorCode {
  return typeof value === "string" && (SOCKET_ERROR_CODES as readonly string[]).includes(value);
}

export function isConnectErrorCode(value: unknown): value is ConnectErrorCode {
  return typeof value === "string" && (CONNECT_ERROR_CODES as readonly string[]).includes(value);
}
