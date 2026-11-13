// What a failed accounts mutation means for the card (phase-04 plan §5.8, §7.3.3).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "@/lib/api/errors";
import { linkErrorOf, syncErrorOf } from "./errors";

const err = (status: number, code: ConstructorParameters<typeof ApiError>[0]["code"], reason?: string) =>
  new ApiError({ status, code, details: reason ? { reason } : undefined, retryAfterSec: code === "rate_limited" ? 30 : undefined });

describe("linkErrorOf (ACC-3 from settings)", () => {
  it("maps each answer to the card's copy", () => {
    assert.equal(linkErrorOf(null), null);
    assert.equal(linkErrorOf(err(404, "not_found")), "not_found");
    assert.equal(linkErrorOf(err(409, "conflict", "profile_closed")), "profile_closed");
    assert.equal(linkErrorOf(err(409, "conflict", "linked_elsewhere")), "linked_elsewhere");
    assert.equal(linkErrorOf(err(409, "conflict", "already_linked")), "already_linked");
    assert.equal(linkErrorOf(err(409, "conflict", "sync_running")), "upstream");
    assert.equal(linkErrorOf(err(429, "rate_limited")), "rate_limited");
    assert.equal(linkErrorOf(err(400, "validation_failed")), "invalid");
    assert.equal(linkErrorOf(err(502, "upstream_unavailable")), "upstream");
    assert.equal(linkErrorOf(err(0, "aborted")), null, "a superseded request is not an error");
    assert.equal(linkErrorOf(new Error("boom")), "upstream");
  });
});

describe("syncErrorOf (ACC-4)", () => {
  it("402 is the inline trial message; 409 sync_running and 429 are states, not errors", () => {
    assert.equal(syncErrorOf(null), null);
    assert.equal(syncErrorOf(err(402, "subscription_required", "required")), "paywall");
    assert.equal(syncErrorOf(err(409, "conflict", "sync_running")), null);
    assert.equal(syncErrorOf(err(429, "rate_limited")), null);
    assert.equal(syncErrorOf(err(404, "not_found")), "failed");
    assert.equal(syncErrorOf(err(500, "internal")), "failed");
    assert.equal(syncErrorOf(new Error("network")), "failed");
  });
});
