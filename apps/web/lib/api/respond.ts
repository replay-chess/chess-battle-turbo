// Response builders for route() (plan §7.1 envelope, §7.2 step 9–10).
//
// Handlers normally return plain data and let route() wrap it. respondWith() lets a handler add what only it knows:
// a precomputed ETag (openings), a Location for 201, extra headers, or a one-release top-level legacy mirror
// (socket-token's `token`/`expiresAt`, plan §7.1).
import type { ErrorCode } from "@repo/contracts/http/codes";
import { ERROR_STATUS } from "@repo/contracts/http/codes";
import { ApiError, DEFAULT_ERROR_MESSAGES } from "./api-error";
import { NO_STORE } from "./cache";
import { REQUEST_ID_HEADER } from "./request-id";

const RESULT = Symbol.for("rc.api.result");

export type ResultOptions = {
  /** Precomputed tag (quoted or bare) for the ETag tiers; skips hashing the body. */
  etag?: string;
  /** 201 needs `location`. */
  status?: 200 | 201 | 202;
  location?: string;
  /** Extra response headers. Never Cache-Control (route() owns the tier). */
  headers?: Record<string, string>;
  /** Top-level keys merged next to `data` for one release (legacy readers). */
  legacyMirror?: Record<string, unknown>;
};

export type RouteResult<T> = { readonly [RESULT]: true; readonly data: T; readonly options: ResultOptions };

export function respondWith<T>(data: T, options: ResultOptions): RouteResult<T> {
  return { [RESULT]: true, data, options };
}

/** 201 with a Location header. */
export function created<T>(data: T, location: string): RouteResult<T> {
  return respondWith(data, { status: 201, location });
}

export function isRouteResult(value: unknown): value is RouteResult<unknown> {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[RESULT] === true;
}

export type ErrorBodyInit = {
  code: ErrorCode;
  message?: string;
  fields?: Record<string, string>;
  details?: Record<string, unknown>;
  retryAfterSec?: number;
  requestId: string;
};

/** The `{ error }` envelope body. */
export function errorBody(init: ErrorBodyInit): { error: Record<string, unknown> } {
  const error: Record<string, unknown> = {
    code: init.code,
    message: init.message ?? DEFAULT_ERROR_MESSAGES[init.code],
  };
  if (init.fields && Object.keys(init.fields).length) error.fields = init.fields;
  if (init.details && Object.keys(init.details).length) error.details = init.details;
  if (init.retryAfterSec !== undefined) error.retryAfterSec = init.retryAfterSec;
  error.requestId = init.requestId;
  return { error };
}

/**
 * An error response: status from the code ledger, `Cache-Control: private, no-store`, `x-request-id`, and
 * `Retry-After` whenever retryAfterSec is set. `topLevel` adds legacy mirror keys (the 402 mirror, plan §7.1).
 */
export function errorResponse(
  init: ErrorBodyInit,
  extra: { headers?: Record<string, string>; topLevel?: Record<string, unknown> } = {},
): Response {
  const headers = new Headers(extra.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", NO_STORE);
  headers.set(REQUEST_ID_HEADER, init.requestId);
  if (init.retryAfterSec !== undefined) headers.set("Retry-After", String(init.retryAfterSec));
  const body = { ...extra.topLevel, ...errorBody(init) };
  return new Response(JSON.stringify(body), { status: ERROR_STATUS[init.code], headers });
}

/** errorResponse() for a thrown ApiError. */
export function apiErrorResponse(err: ApiError, requestId: string, extra?: Parameters<typeof errorResponse>[1]): Response {
  return errorResponse(
    {
      code: err.code,
      message: err.message,
      fields: err.fields,
      details: err.details,
      retryAfterSec: err.retryAfterSec,
      requestId,
    },
    extra,
  );
}
