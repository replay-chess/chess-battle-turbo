// The one error-code ledger (phase-01 plan §7.1, CC R-06). Append-only: adding a code is an additive contract change,
// made by the first phase that produces it. P2 added `in_flight` 409, `idempotency_key_reused` 422,
// `illegal_position` 422 and `illegal_moves` 422; P3 added `gone` 410. Codes later phases add (so nobody adds them
// twice): `fair_use_limit` 429 (P7); `reverification_required` 403 (P10, or P12 if it merges first); `precondition_failed` 412 (P12).
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
  // P2 (phase-02 plan §0.2, consistency R-06)
  in_flight: 409,
  idempotency_key_reused: 422,
  illegal_position: 422,
  illegal_moves: 422,
  // P3 (phase-03 plan §7.1): a terminal resource. A FAILED analysis whose attempts are used up (A3, A4), a legend
  // comparison whose 3 compute attempts are used up (A9b), a revoked or expired share on the API (A11).
  gone: 410,
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
 * P2 already_started, already_completed, not_bot_game, not_finished, rev_gap; P3 and P4 below; P12 …).
 */
export const CONFLICT_REASONS = [
  "already_started",
  "already_completed",
  "not_bot_game",
  "not_finished",
  "rev_gap",
  // P3 (phase-03 plan §7.1, §7.2): `skipped` A3 on a game under 6 plies or aborted; `already_running` A4 while the
  // job runs; `not_failed` A4 on a done job; `analysis_not_done` A7, A8 and A10 before the analysis is done;
  // `already_ready` A9b when the comparison is already READY.
  "skipped",
  "already_running",
  "not_failed",
  "analysis_not_done",
  "already_ready",
  // P4 (phase-04 plan §0.2 D4-05, §7.3, §7.4): `linked_elsewhere` ACC-2/ACC-3 when another user holds a verified
  // link to the account; `already_linked` ACC-3 when this user links a different account of the provider;
  // `sync_running` ACC-4/ACC-8 while a run is active; `plan_required` ME-4 `complete` without entitlement;
  // `profile_closed` ACC-3 for a closed Chess.com account. P4 also uses P3's `not_failed` (ACC-8 on a run that did
  // not fail), so it is not listed twice.
  "linked_elsewhere",
  "already_linked",
  "sync_running",
  "plan_required",
  "profile_closed",
] as const;
export type ConflictReason = (typeof CONFLICT_REASONS)[number];

/** details.reason for 403 forbidden. Append-only. */
export const FORBIDDEN_REASONS = ["cooldown"] as const;
export type ForbiddenReason = (typeof FORBIDDEN_REASONS)[number];

/**
 * details.reason for 400 validation_failed beyond field errors. Append-only (P2: LEGEND_BOT before P8's flag; P3:
 * PR1's `?fen=` that parses but is not a legal position, phase-03 §7.2).
 */
export const VALIDATION_REASONS = ["mode_not_available", "illegal_position"] as const;
export type ValidationReason = (typeof VALIDATION_REASONS)[number];

/** details.reason for 422 illegal_moves. Append-only (P2: claimed result not consistent with the board, §8.16). */
export const ILLEGAL_MOVES_REASONS = ["claim_mismatch"] as const;
export type IllegalMovesReason = (typeof ILLEGAL_MOVES_REASONS)[number];

/**
 * Codes a bare status never maps to (codeForStatus): each names one specific situation, so a legacy 409 stays
 * `conflict` and a legacy 422 stays `internal` instead of borrowing a P2 meaning.
 */
const NOT_INFERRED_FROM_STATUS: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "in_flight",
  "idempotency_key_reused",
  "illegal_position",
  "illegal_moves",
]);

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
  for (const code of ERROR_CODES) if (ERROR_STATUS[code] === status && !NOT_INFERRED_FROM_STATUS.has(code)) return code;
  return "internal";
}
