import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALLOWED_STATUSES,
  codeForStatus,
  CONFLICT_REASONS,
  ERROR_CODES,
  ERROR_STATUS,
  FORBIDDEN_REASONS,
  isErrorCode,
  statusFor,
  SUBSCRIPTION_REASONS,
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
    for (const list of [SUBSCRIPTION_REASONS, CONFLICT_REASONS, FORBIDDEN_REASONS] as readonly (readonly string[])[]) {
      assert.equal(new Set(list).size, list.length);
    }
  });

  it("pins the P1 ledger (append-only: removing or remapping a code is a breaking change)", () => {
    assert.deepEqual(ERROR_STATUS, {
      invalid_json: 400, validation_failed: 400, unauthorized: 401,
      subscription_required: 402, payment_update_required: 402,
      forbidden: 403, not_found: 404, conflict: 409, already_subscribed: 409,
      payload_too_large: 413, rate_limited: 429, internal: 500, upstream_unavailable: 502,
      maintenance: 503, not_configured: 503, unavailable: 503,
    });
    assert.deepEqual([...SUBSCRIPTION_REASONS], ["trial_available", "trial_used", "expired", "payment_failed"]);
    assert.deepEqual([...FORBIDDEN_REASONS], ["cooldown"]);
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
