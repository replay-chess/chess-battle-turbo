// The pure halves of the weakness hooks (phase-06 plan §5.4): Retry's optimistic computing payload, the seen rule,
// TR-7's error mapping, the telemetry zoom bucket.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WeaknessPayload as WeaknessPayloadSchema } from "@repo/contracts/http/weakness";
import { weaknessPayloadFixture } from "@/components/train/weakness/__fixtures__/payloads";
import { ApiError } from "@/lib/api/errors";
import { zoomBucketOf } from "./telemetry";
import { initialProgress, optimisticComputing, WITH_BULLET } from "./useRecomputeWeakness";
import { seenVersionDue } from "./useMarkWeaknessSeen";
import { isEmptyDrill, startResult } from "./useStartWeaknessDrill";

describe("weakness hooks (pure parts)", () => {
  it("Retry's optimistic payload is a valid computing payload with 4 steps and no failure", () => {
    const failed = weaknessPayloadFixture("failed");
    const next = optimisticComputing(failed);
    assert.equal(next.status, "computing");
    assert.equal(next.failure, null);
    assert.equal(next.progress!.steps.length, 4);
    assert.equal(next.progress!.steps[0]!.state, "done");
    assert.equal(next.progress!.steps[1]!.state, "done", "22 analysed: grading is done");
    assert.equal(next.progress!.steps[2]!.state, "run");
    const r = WeaknessPayloadSchema.safeParse(next);
    assert.equal(r.success, true, JSON.stringify(r.error?.issues));
    const few = initialProgress({ games: { analysed: 4, inScope: 9, pending: 5, required: 20, preliminaryFrom: 5 }, band: null });
    assert.equal(few.steps[1]!.state, "run");
    assert.equal(few.steps[3]!.label, "Compare with players at your level");
    assert.deepEqual(WITH_BULLET, ["BULLET", "BLITZ", "RAPID"]);
  });

  it("seen: once the ready profile is on screen and its version is newer than the seen one", () => {
    const p = weaknessPayloadFixture("ready");
    assert.equal(seenVersionDue(p, true), 3);
    assert.equal(seenVersionDue(p, false), null, "the ready flash still covers it");
    assert.equal(seenVersionDue({ ...p, seenVersion: 3 }, true), null);
    assert.equal(seenVersionDue(weaknessPayloadFixture("computing"), true), null);
    // regression: weakness-dot-stuck — a READY write bumped the version, then an INSUFFICIENT (or FAILED) snapshot
    // replaced it before the member looked: the settled page clears the dot.
    assert.equal(seenVersionDue({ ...weaknessPayloadFixture("insufficient"), version: 4, seenVersion: 3 }, true), 4);
    assert.equal(seenVersionDue({ ...weaknessPayloadFixture("failed"), version: 4, seenVersion: 3 }, true), 4);
    assert.equal(seenVersionDue(undefined, true), null);
  });

  it("TR-7 errors: empty drill, rate limit, the rest", () => {
    const empty = new ApiError({ status: 400, code: "validation_failed", details: { reason: "empty_drill" } });
    const unknown = new ApiError({ status: 400, code: "validation_failed", details: { reason: "unknown_pattern" } });
    const limited = new ApiError({ status: 429, code: "rate_limited", retryAfterSec: 60 });
    assert.equal(isEmptyDrill(empty), true);
    assert.equal(isEmptyDrill(unknown), false);
    assert.equal(startResult(empty), "empty");
    assert.equal(startResult(limited), "rate_limited");
    assert.equal(startResult(new ApiError({ status: 500, code: "internal" })), "error");
    assert.equal(startResult(new Error("x")), "error");
  });

  it("zoom bucket from the window's outer/inner width (desktop only)", () => {
    assert.equal(zoomBucketOf(1440, 1440, "desktop"), "100");
    assert.equal(zoomBucketOf(1440, 960, "desktop"), "150");
    assert.equal(zoomBucketOf(1440, 1152, "desktop"), "125");
    assert.equal(zoomBucketOf(1440, 1800, "desktop"), "80");
    assert.equal(zoomBucketOf(1440, 1309, "desktop"), "110");
    assert.equal(zoomBucketOf(1440, 1000, "desktop"), "other");
    assert.equal(zoomBucketOf(393, 300, "phone"), "100");
    assert.equal(zoomBucketOf(0, 0, "desktop"), "100");
  });
});
