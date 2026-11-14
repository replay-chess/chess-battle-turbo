import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALLOWED_STATUSES,
  codeForStatus,
  CONFLICT_REASONS,
  ERROR_CODES,
  ERROR_STATUS,
  FORBIDDEN_REASONS,
  ILLEGAL_MOVES_REASONS,
  isErrorCode,
  RATE_LIMIT_REASONS,
  statusFor,
  SUBSCRIPTION_REASONS,
  VALIDATION_REASONS,
} from "./codes";

describe("codes", () => {
  it("maps every code to exactly one allowed status", () => {
    const allowed = new Set<number>(ALLOWED_STATUSES);
    for (const [code, status] of Object.entries(ERROR_STATUS)) {
      assert.equal(typeof status, "number", code);
      assert.ok(allowed.has(status), `${code} → ${status} is not an allowed status`);
    }
  });

  it("has unique codes in snake_case and lists them all in ERROR_CODES", () => {
    assert.equal(new Set(ERROR_CODES).size, ERROR_CODES.length);
    assert.deepEqual([...ERROR_CODES].sort(), Object.keys(ERROR_STATUS).sort());
    for (const code of ERROR_CODES) assert.match(code, /^[a-z]+(_[a-z]+)*$/);
  });

  it("keeps the reason registries free of duplicates", () => {
    for (const list of [
      SUBSCRIPTION_REASONS, CONFLICT_REASONS, FORBIDDEN_REASONS, VALIDATION_REASONS, ILLEGAL_MOVES_REASONS,
    ] as readonly (readonly string[])[]) {
      assert.equal(new Set(list).size, list.length);
    }
  });

  it("pins the P1 + P2 + P3 ledger (append-only: removing or remapping a code is a breaking change)", () => {
    assert.deepEqual(ERROR_STATUS, {
      invalid_json: 400, validation_failed: 400, unauthorized: 401,
      subscription_required: 402, payment_update_required: 402,
      forbidden: 403, not_found: 404, conflict: 409, already_subscribed: 409,
      payload_too_large: 413, rate_limited: 429, internal: 500, upstream_unavailable: 502,
      maintenance: 503, not_configured: 503, unavailable: 503,
      // P2
      in_flight: 409, idempotency_key_reused: 422, illegal_position: 422, illegal_moves: 422,
      // P3
      gone: 410,
    });
    // Ledger order is append-only too: P1's and P2's codes keep their positions.
    assert.deepEqual(ERROR_CODES.slice(-5), ["in_flight", "idempotency_key_reused", "illegal_position", "illegal_moves", "gone"]);
    assert.deepEqual([...SUBSCRIPTION_REASONS], ["trial_available", "trial_used", "expired", "payment_failed"]);
    assert.deepEqual([...FORBIDDEN_REASONS], ["cooldown"]);
  });

  it("has the P2 rows of phase-02 §0.2", () => {
    assert.equal(statusFor("in_flight"), 409);
    assert.equal(statusFor("idempotency_key_reused"), 422);
    assert.equal(statusFor("illegal_position"), 422);
    assert.equal(statusFor("illegal_moves"), 422);
    for (const reason of ["already_started", "already_completed", "not_bot_game", "not_finished", "rev_gap"]) {
      assert.ok((CONFLICT_REASONS as readonly string[]).includes(reason), reason);
    }
    assert.deepEqual([...CONFLICT_REASONS].slice(0, 5), ["already_started", "already_completed", "not_bot_game", "not_finished", "rev_gap"]);
    // mode_not_available is a validation_failed reason (400), claim_mismatch an illegal_moves reason (422): not codes.
    assert.deepEqual([...VALIDATION_REASONS].slice(0, 1), ["mode_not_available"]);
    assert.deepEqual([...ILLEGAL_MOVES_REASONS], ["claim_mismatch"]);
    assert.equal(isErrorCode("mode_not_available"), false);
    assert.equal(isErrorCode("claim_mismatch"), false);
  });

  it("has the P3 rows of phase-03 §7.1: gone → 410 and the five conflict reasons, appended after P2's", () => {
    assert.equal(statusFor("gone"), 410);
    assert.equal(isErrorCode("gone"), true);
    assert.equal(codeForStatus(410), "gone");
    // Append-only: P2's, P3's and P4's reasons keep their positions (P5 appends after them, see below).
    assert.deepEqual([...CONFLICT_REASONS].slice(0, 15), [
      "already_started", "already_completed", "not_bot_game", "not_finished", "rev_gap",
      "skipped", "already_running", "not_failed", "analysis_not_done", "already_ready",
      "linked_elsewhere", "already_linked", "sync_running", "plan_required", "profile_closed",
    ]);
    // PR1: a FEN that parses but is not a legal position is a 400 validation_failed reason (not the P2 422 code).
    assert.deepEqual([...VALIDATION_REASONS].slice(0, 2), ["mode_not_available", "illegal_position"]);
  });

  it("has the P4 rows of phase-04 §0.2 D4-05: the six conflict reasons (P3's not_failed reused), no new codes", () => {
    for (const reason of ["linked_elsewhere", "already_linked", "sync_running", "not_failed", "plan_required", "profile_closed"]) {
      assert.ok((CONFLICT_REASONS as readonly string[]).includes(reason), reason);
    }
    assert.equal(CONFLICT_REASONS.filter((r) => r === "not_failed").length, 1);
    // One status per code (consistency R-06): upstream_unavailable is always 502, rate_limited always 429.
    assert.equal(statusFor("upstream_unavailable"), 502);
    assert.equal(statusFor("rate_limited"), 429);
    assert.equal(ERROR_CODES.length, 21, "P4 adds no error code");
  });

  it("has the P5 rows of phase-05 §0, §5.6, §7.2: session_ended, two validation reasons, the durable 429 reasons, no new code", () => {
    assert.deepEqual([...CONFLICT_REASONS].slice(15), ["session_ended"]);
    assert.deepEqual([...VALIDATION_REASONS].slice(2), ["cursor_filter_mismatch", "new_per_day_above_cap"]);
    assert.deepEqual([...RATE_LIMIT_REASONS], ["daily_puzzle_limit", "session_limit", "report_limit"]);
    assert.equal(new Set(RATE_LIMIT_REASONS).size, RATE_LIMIT_REASONS.length);
    assert.equal(ERROR_CODES.length, 21, "P5 adds no error code");
    assert.equal(isErrorCode("session_ended"), false, "a conflict reason, not a code");
  });

  it("never infers a P2 code from a bare status", () => {
    assert.equal(codeForStatus(409), "conflict");
    assert.equal(codeForStatus(422), "internal");
  });

  it("never contains the codes the plan bans", () => {
    for (const banned of [
      "membership_ended", "origin_mismatch", "upstream_timeout", "upstream_error", "refresh_failed",
      "upstream_rate_limited", "unauthenticated", "bad_request", "unsupported_media_type",
    ]) {
      assert.equal(isErrorCode(banned), false, banned);
    }
  });

  it("helpers", () => {
    assert.equal(statusFor("rate_limited"), 429);
    assert.equal(isErrorCode("not_found"), true);
    assert.equal(isErrorCode("toString"), false);
    assert.equal(isErrorCode(404), false);
    assert.equal(codeForStatus(401), "unauthorized");
    assert.equal(codeForStatus(404), "not_found");
    assert.equal(codeForStatus(400), "invalid_json");
    assert.equal(codeForStatus(418), "internal");
  });
});
