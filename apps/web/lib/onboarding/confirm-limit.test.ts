import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isApiError } from "@/lib/api/api-error";
import { CONFIRM_LOOKUP_LIMITS, limitConfirmLookup } from "./confirm-limit";

describe("Confirm preview rate limit (FIX-1, plan §11.2)", () => {
  it("regression: confirm-preview-rate-limit: spends the lookup's user and IP buckets", async () => {
    const seen: unknown[] = [];
    await limitConfirmLookup({ clerkUserId: "user_1", ip: "203.0.113.9" }, async (specs, subject) => {
      seen.push(specs.map((s) => [s.bucket, s.limit, s.windowSec, s.by]), subject);
      return { allowed: true, retryAfterSec: 0 };
    });
    assert.deepEqual(seen, [
      [
        ["lookup", 10, 60, "user"],
        ["lookup-ip", 30, 60, "ip"],
      ],
      { clerkUserId: "user_1", ip: "203.0.113.9" },
    ]);
    assert.equal(CONFIRM_LOOKUP_LIMITS.length, 2);
  });

  it("a denied check is a 429 rate_limited the page renders as its unavailable card", async () => {
    await assert.rejects(
      limitConfirmLookup({ clerkUserId: "user_1", ip: null }, async () => ({ allowed: false, retryAfterSec: 0, bucket: "lookup-ip" })),
      (e: unknown) => isApiError(e) && e.code === "rate_limited" && e.retryAfterSec === 1 && (e.details as { bucket: string }).bucket === "lookup-ip",
    );
  });
});
