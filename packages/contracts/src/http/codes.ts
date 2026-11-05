// The one error-code ledger (phase-01 plan §7.1, CC R-06). Append-only: adding a code is an additive contract change,
// made by the first phase that produces it. Codes later phases add (so nobody adds them twice): `in_flight` 409,
// `idempotency_key_reused` 422, `illegal_position` 422, `illegal_moves` 422 (P2); `gone` 410 (P3);
// `fair_use_limit` 429 (P7); `reverification_required` 403 (P10, or P12 if it merges first); `precondition_failed` 412 (P12).
// Never codes: `membership_ended`, `origin_mismatch`, `upstream_timeout`, `upstream_error`, `refresh_failed`,
// `upstream_rate_limited`, `unauthenticated`, `bad_request`, `unsupported_media_type` (see the plan for their replacements).

export const ERROR_STATUS = {
  invalid_json: 400,
  validation_failed: 400,
  unauthorized: 401,
  subscription_required: 402,
  payment_update_required: 402,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  already_subscribed: 409,
  payload_too_large: 413,
  rate_limited: 429,
  internal: 500,
  upstream_unavailable: 502,
  maintenance: 503,
  not_configured: 503,
  unavailable: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** Every code, in ledger order. */
export const ERROR_CODES = Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]];

/** Statuses any phase may use. codes.test.ts asserts every code maps to exactly one of these. */
export const ALLOWED_STATUSES = [400, 401, 402, 403, 404, 409, 410, 412, 413, 422, 429, 500, 502, 503] as const;
export type ErrorStatus = (typeof ALLOWED_STATUSES)[number];

/** details.reason for 402 subscription_required (plan §8.3). P10 appends "paused". */
export const SUBSCRIPTION_REASONS = ["trial_available", "trial_used", "expired", "payment_failed"] as const;
export type SubscriptionReason = (typeof SUBSCRIPTION_REASONS)[number];

/**
 * details.reason for 409 conflict. Append-only; each phase registers the reasons it introduces (CC R-06 list:
 * P2 already_started, already_completed, not_bot_game, rev_gap; P4 …; P12 …).
 */
export const CONFLICT_REASONS = [] as const;
export type ConflictReason = (typeof CONFLICT_REASONS)[number];

/** details.reason for 403 forbidden. Append-only. */
export const FORBIDDEN_REASONS = ["cooldown"] as const;
export type ForbiddenReason = (typeof FORBIDDEN_REASONS)[number];

/** The HTTP status for a code. */
export function statusFor(code: ErrorCode): (typeof ERROR_STATUS)[ErrorCode] {
  return ERROR_STATUS[code];
}

/** Narrowing guard for a string read off the wire. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ERROR_STATUS, value);
}

/** The first ledger code for a status, used to map legacy bodies that carry no code (lib/api/legacy.ts). */
export function codeForStatus(status: number): ErrorCode {
  for (const code of ERROR_CODES) if (ERROR_STATUS[code] === status) return code;
  return "internal";
}
