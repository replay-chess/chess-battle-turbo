// Server-side domain error for route() handlers (plan §7.1, §7.2 step 7 and 10).
//
//   throw new ApiError("not_found");
//   throw new ApiError("conflict", { details: { reason: "in_progress" } });
//
// The wrapper turns it into the envelope `{ error: { code, message, fields?, details?, retryAfterSec?, requestId } }`
// with the status the code maps to in @repo/contracts/http/codes. The client-side ApiError lives in lib/api/errors.ts.
import { ERROR_STATUS, type ErrorCode } from "@repo/contracts/http/codes";

/** One safe English sentence per code. Never an exception message. */
export const DEFAULT_ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  invalid_json: "The request body is not valid JSON.",
  validation_failed: "Some fields are invalid.",
  unauthorized: "Sign in to continue.",
  subscription_required: "A ReplayChess membership is needed for this.",
  payment_update_required: "Update your payment method to continue.",
  forbidden: "You don't have access to this.",
  not_found: "Not found.",
  conflict: "This conflicts with the current state. Refresh and try again.",
  already_subscribed: "You already have a membership.",
  payload_too_large: "The request is too large.",
  rate_limited: "Too many requests. Try again shortly.",
  internal: "Something went wrong",
  upstream_unavailable: "A service we depend on is unavailable. Try again shortly.",
  maintenance: "ReplayChess is down for maintenance. Try again shortly.",
  not_configured: "This feature is not configured.",
  unavailable: "The service is temporarily unavailable. Try again shortly.",
  // Phase 2 ledger rows (@repo/contracts/http/codes).
  in_flight: "This request is already being processed. Try again in a moment.",
  idempotency_key_reused: "This request key was already used for a different request.",
  illegal_position: "This starting position is not valid.",
  illegal_moves: "These moves are not legal from the game's position.",
};

export type ApiErrorInit = {
  message?: string;
  /** validation_failed: path → message. */
  fields?: Record<string, string>;
  details?: Record<string, unknown>;
  /** Also sent as the Retry-After header. */
  retryAfterSec?: number;
  /** Kept for Sentry and logs; never sent to the client. */
  cause?: unknown;
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly details?: Record<string, unknown>;
  readonly retryAfterSec?: number;

  constructor(code: ErrorCode, init: ApiErrorInit = {}) {
    super(init.message ?? DEFAULT_ERROR_MESSAGES[code], init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ApiError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    if (init.fields) this.fields = init.fields;
    if (init.details) this.details = init.details;
    if (init.retryAfterSec !== undefined) this.retryAfterSec = Math.max(0, Math.ceil(init.retryAfterSec));
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
