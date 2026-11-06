// `/internal/*` request authentication (phase-02 plan 7.5.1): HMAC verify through @repo/contracts/internal/auth
// (kid, ts within ±60 s, signature over ts + method + path + sha256(raw body), timing-safe compare), the 2-minute
// nonce set of seen signatures, and the per-kid allow-lists (`web` may emit every registered event and call emit,
// tournament-event and metrics; `ops` only broadcast, drain and metrics; `wk` (P3) only its event domains).
// Every failure answers 401 with no detail and counts `ws.internal.auth_fail{reason}`. The v2 server never reads
// `x-internal-token`; the static token lives only in src/v1/ while PROTOCOL_V1=on.
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import {
  HEADER_KID,
  HEADER_SIG,
  HEADER_TS,
  INTERNAL_POLICY,
  ReplayGuard,
  kidMayCall,
  kidMayEmit,
  verifyInternal,
  type InternalPath,
  type KeyRing,
} from "@repo/contracts/internal/auth";
import type { InternalErrorBody } from "@repo/contracts/socket/internal";
import { INTERNAL_BODY_MAX_BYTES } from "@repo/contracts/socket/limits";
import type { Logger, Metrics } from "../ports";

export { INTERNAL_POLICY, kidMayCall, kidMayEmit };

export interface InternalAuthDeps {
  keys: KeyRing;
  replay: ReplayGuard;
  now(): number;
  metrics: Metrics;
  log: Logger;
}

export interface InternalRequest {
  kid: string;
  /** The exact bytes that were signed. */
  raw: Buffer;
}

export type InternalHandler = (req: Request, res: Response, ctx: InternalRequest) => void | Promise<void>;

export function sendError(res: Response, status: number, code: InternalErrorBody["error"]["code"]): void {
  res.status(status).json({ error: { code } } satisfies InternalErrorBody);
}

/** The raw body as signed (an empty buffer for a request without one). */
export const rawBody: RequestHandler = express.raw({ type: () => true, limit: INTERNAL_BODY_MAX_BYTES });

function bodyOf(req: Request): Buffer {
  return Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
}

/** True when the request carries none of the signing headers (the legacy static-token caller). */
export function isUnsigned(req: Request): boolean {
  return !req.get(HEADER_KID) && !req.get(HEADER_TS) && !req.get(HEADER_SIG);
}

/**
 * The handler chain of one internal path: raw body → HMAC verify (+ replay) → path allow-list → `handler`.
 * `fallthroughUnsigned` passes a request with no signing headers on to the next route (the v1 static-token
 * `/internal/tournament-event`, mounted only while PROTOCOL_V1=on).
 */
export function internalRoute(
  deps: InternalAuthDeps,
  path: InternalPath,
  handler: InternalHandler,
  options: { fallthroughUnsigned?: boolean } = {},
): RequestHandler[] {
  const verify = (req: Request, res: Response, next: NextFunction) => {
    if (options.fallthroughUnsigned && isUnsigned(req)) {
      // The raw parser consumed the stream: hand the legacy route the parsed JSON it expects.
      const parsed = jsonOf(bodyOf(req));
      req.body = parsed && typeof parsed === "object" ? parsed : {};
      next("route");
      return;
    }
    const raw = bodyOf(req);
    const result = verifyInternal({
      headers: req.headers,
      method: req.method,
      path: req.originalUrl,
      body: raw,
      keys: deps.keys,
      nowMs: deps.now(),
      replay: deps.replay,
    });
    if (!result.ok) {
      deps.metrics.count("ws.internal.auth_fail", { reason: result.reason });
      deps.log.warn("internal request refused", { path, reason: result.reason });
      sendError(res, 401, "unauthorized");
      return;
    }
    if (!kidMayCall(result.kid, path)) {
      deps.metrics.count("ws.internal.auth_fail", { reason: "path" });
      sendError(res, 403, "forbidden");
      return;
    }
    Promise.resolve(handler(req, res, { kid: result.kid, raw })).catch((error: unknown) => {
      deps.log.error("internal handler failed", { path }, error);
      if (!res.headersSent) sendError(res, 500, "internal");
    });
  };
  return [rawBody, verify];
}

/** Parses the raw JSON body; null when it is not JSON. */
export function jsonOf(raw: Buffer): unknown {
  if (raw.length === 0) return null;
  try {
    return JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
}
